import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { referenceImagesDir } from "./db.js";

const COMPARE_SIZE = 64;

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

export async function testDetection(
  testImageBuffer: Buffer,
  gameStates: Array<{ id: string; name: string }>,
  referenceImages: Map<string, Array<{ id: string; filename: string }>>,
): Promise<MatchResult[]> {
  const testPixels = await toNormalizedPixels(testImageBuffer);
  const results: MatchResult[] = [];

  for (const gs of gameStates) {
    const refs = referenceImages.get(gs.id) ?? [];
    for (const ref of refs) {
      const filePath = path.join(referenceImagesDir, gs.id, ref.filename);
      if (!fs.existsSync(filePath)) continue;

      const refBuffer = fs.readFileSync(filePath);
      const refPixels = await toNormalizedPixels(refBuffer);

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
