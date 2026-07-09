import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { referenceImagesDir } from "./db.js";

const COMPARE_SIZE = 64;
const TEMPLATE_WIDTH = 1280;
const TEMPLATE_HEIGHT = 720;

// Cache for reference image pixels — keyed by "imageId:regionsHash"
const refPixelCache = new Map<string, Float32Array>();

export function clearRefPixelCache(): void {
  refPixelCache.clear();
}

export type DetectionRegion = { x: number; y: number; width: number; height: number };

async function toNormalizedPixels(input: Buffer): Promise<Float32Array> {
  const { data, info } = await sharp(input)
    .resize(COMPARE_SIZE, COMPARE_SIZE, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Float32Array(info.width * info.height);
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = data[i] / 255;
  }
  return pixels;
}

async function toNormalizedPixelsWithRegions(
  input: Buffer,
  regions: DetectionRegion[],
): Promise<Float32Array> {
  if (regions.length === 0) {
    return toNormalizedPixels(input);
  }

  // Scale full image to template size first for consistent coordinate space
  const scaledBuffer = await sharp(input)
    .resize(TEMPLATE_WIDTH, TEMPLATE_HEIGHT, { fit: "fill" })
    .toBuffer();

  const regionArrays: Float32Array[] = [];
  for (const region of regions) {
    const left = Math.max(0, Math.round(region.x));
    const top = Math.max(0, Math.round(region.y));
    const width = Math.min(TEMPLATE_WIDTH - left, Math.max(1, Math.round(region.width)));
    const height = Math.min(TEMPLATE_HEIGHT - top, Math.max(1, Math.round(region.height)));

    const { data, info } = await sharp(scaledBuffer)
      .extract({ left, top, width, height })
      .resize(COMPARE_SIZE, COMPARE_SIZE, { fit: "fill" })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixels = new Float32Array(info.width * info.height);
    for (let i = 0; i < pixels.length; i++) {
      pixels[i] = data[i] / 255;
    }
    regionArrays.push(pixels);
  }

  // Concatenate all regions into one feature vector
  const totalLen = regionArrays.reduce((sum, arr) => sum + arr.length, 0);
  const combined = new Float32Array(totalLen);
  let offset = 0;
  for (const arr of regionArrays) {
    combined.set(arr, offset);
    offset += arr.length;
  }
  return combined;
}

function computeSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < a.length; i++) {
    sumA += a[i];
    sumB += b[i];
  }
  const meanA = sumA / a.length;
  const meanB = sumB / b.length;

  let numerator = 0;
  let denomA = 0;
  let denomB = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    numerator += da * db;
    denomA += da * da;
    denomB += db * db;
  }

  const denom = Math.sqrt(denomA * denomB);
  if (denom < 1e-10) return 0;

  const ncc = numerator / denom;
  return Math.max(0, Math.min(1, (ncc + 1) / 2));
}

function histogramSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length === 0 || b.length === 0) return 0;

  const bins = 32;
  const histA = new Float32Array(bins);
  const histB = new Float32Array(bins);

  for (let i = 0; i < a.length; i++) {
    const binA = Math.min(bins - 1, Math.floor(a[i] * bins));
    const binB = Math.min(bins - 1, Math.floor(b[i] * bins));
    histA[binA]++;
    histB[binB]++;
  }

  for (let i = 0; i < bins; i++) {
    histA[i] /= a.length;
    histB[i] /= b.length;
  }

  let intersection = 0;
  for (let i = 0; i < bins; i++) {
    intersection += Math.min(histA[i], histB[i]);
  }
  return intersection;
}

export type MatchResult = {
  gameStateId: string;
  gameStateName: string;
  imageId: string;
  filename: string;
  ncc: number;
  histogram: number;
  combined: number;
};

export type RefPixelData = {
  gameStateId: string;
  gameStateName: string;
  imageId: string;
  filename: string;
  pixels: number[];
  regions: DetectionRegion[];
};

export async function getDetectionRefs(
  gameStates: Array<{ id: string; name: string }>,
  referenceImages: Map<string, Array<{ id: string; filename: string }>>,
  detectionRegions?: Map<string, DetectionRegion[]>,
): Promise<RefPixelData[]> {
  const results: RefPixelData[] = [];
  for (const gs of gameStates) {
    const regions = detectionRegions?.get(gs.id) ?? [];
    const regionsKey = regions.map(r => `${r.x},${r.y},${r.width},${r.height}`).join("|");
    const refs = referenceImages.get(gs.id) ?? [];
    for (const ref of refs) {
      const cacheKey = `${ref.id}:${regionsKey}`;
      let refPixels = refPixelCache.get(cacheKey);
      if (!refPixels) {
        const filePath = path.join(referenceImagesDir, gs.id, ref.filename);
        if (!fs.existsSync(filePath)) continue;
        const refBuffer = fs.readFileSync(filePath);
        refPixels = await toNormalizedPixelsWithRegions(refBuffer, regions);
        refPixelCache.set(cacheKey, refPixels);
      }
      results.push({
        gameStateId: gs.id,
        gameStateName: gs.name,
        imageId: ref.id,
        filename: ref.filename,
        pixels: Array.from(refPixels),
        regions,
      });
    }
  }
  return results;
}

export const DETECTION_COMPARE_SIZE = COMPARE_SIZE;
export const DETECTION_TEMPLATE_WIDTH = TEMPLATE_WIDTH;
export const DETECTION_TEMPLATE_HEIGHT = TEMPLATE_HEIGHT;

export async function testDetection(
  testImageBuffer: Buffer,
  gameStates: Array<{ id: string; name: string }>,
  referenceImages: Map<string, Array<{ id: string; filename: string }>>,
  detectionRegions?: Map<string, DetectionRegion[]>,
): Promise<MatchResult[]> {
  const results: MatchResult[] = [];

  // Cache test pixels per unique regions key to avoid reprocessing
  const testPixelsByRegions = new Map<string, Float32Array>();

  for (const gs of gameStates) {
    const regions = detectionRegions?.get(gs.id) ?? [];
    const regionsKey = regions.map(r => `${r.x},${r.y},${r.width},${r.height}`).join("|");

    let testPixels = testPixelsByRegions.get(regionsKey);
    if (!testPixels) {
      testPixels = await toNormalizedPixelsWithRegions(testImageBuffer, regions);
      testPixelsByRegions.set(regionsKey, testPixels);
    }

    const refs = referenceImages.get(gs.id) ?? [];
    for (const ref of refs) {
      const cacheKey = `${ref.id}:${regionsKey}`;
      let refPixels = refPixelCache.get(cacheKey);
      if (!refPixels) {
        const filePath = path.join(referenceImagesDir, gs.id, ref.filename);
        if (!fs.existsSync(filePath)) continue;
        const refBuffer = fs.readFileSync(filePath);
        refPixels = await toNormalizedPixelsWithRegions(refBuffer, regions);
        refPixelCache.set(cacheKey, refPixels);
      }

      const ncc = computeSimilarity(testPixels, refPixels);
      const hist = histogramSimilarity(testPixels, refPixels);
      const combined = ncc * 0.7 + hist * 0.3;

      results.push({
        gameStateId: gs.id,
        gameStateName: gs.name,
        imageId: ref.id,
        filename: ref.filename,
        ncc,
        histogram: hist,
        combined,
      });
    }
  }

  results.sort((a, b) => b.combined - a.combined);
  return results;
}
