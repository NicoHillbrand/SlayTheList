/**
 * Per-item-type isometric renderers.
 * Each function draws into a Phaser Graphics object at the given screen (x, y)
 * which is the center of the tile's top diamond point.
 */

import { TILE_WIDTH, TILE_HEIGHT } from "./iso";

type G = Phaser.GameObjects.Graphics;
const TW = TILE_WIDTH;
const TH = TILE_HEIGHT;
const HW = TW / 2; // half width
const HH = TH / 2; // half height

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Draw a standard isometric diamond (flat tile) */
function diamond(g: G, x: number, y: number, color: number, alpha = 1) {
  g.fillStyle(color, alpha);
  g.beginPath();
  g.moveTo(x, y - HH);
  g.lineTo(x + HW, y);
  g.lineTo(x, y + HH);
  g.lineTo(x - HW, y);
  g.closePath();
  g.fillPath();
}

/** Draw an isometric box (top + left + right faces) */
function isoBox(g: G, x: number, y: number, h: number, top: number, left: number, right: number) {
  // Top
  g.fillStyle(top, 1);
  g.beginPath();
  g.moveTo(x, y - HH - h);
  g.lineTo(x + HW, y - h);
  g.lineTo(x, y + HH - h);
  g.lineTo(x - HW, y - h);
  g.closePath();
  g.fillPath();
  // Left
  g.fillStyle(left, 1);
  g.beginPath();
  g.moveTo(x - HW, y - h);
  g.lineTo(x, y + HH - h);
  g.lineTo(x, y + HH);
  g.lineTo(x - HW, y);
  g.closePath();
  g.fillPath();
  // Right
  g.fillStyle(right, 1);
  g.beginPath();
  g.moveTo(x + HW, y - h);
  g.lineTo(x, y + HH - h);
  g.lineTo(x, y + HH);
  g.lineTo(x + HW, y);
  g.closePath();
  g.fillPath();
}

/** Draw an isometric cylinder-ish shape (for trees, towers) */
function isoColumn(g: G, x: number, y: number, h: number, radiusX: number, radiusY: number, color: number, darken: number) {
  const dark = adjustBrightness(color, darken);
  // Body (left side)
  g.fillStyle(dark, 1);
  g.beginPath();
  g.moveTo(x - radiusX, y - h);
  g.lineTo(x - radiusX, y);
  g.lineTo(x, y + radiusY);
  g.lineTo(x, y + radiusY - h);
  g.closePath();
  g.fillPath();
  // Body (right side)
  g.fillStyle(adjustBrightness(color, darken + 15), 1);
  g.beginPath();
  g.moveTo(x + radiusX, y - h);
  g.lineTo(x + radiusX, y);
  g.lineTo(x, y + radiusY);
  g.lineTo(x, y + radiusY - h);
  g.closePath();
  g.fillPath();
  // Top ellipse
  g.fillStyle(color, 1);
  g.fillEllipse(x, y - h, radiusX * 2, radiusY * 2);
}

function adjustBrightness(color: number, amount: number): number {
  let r = (color >> 16) & 0xff;
  let gr = (color >> 8) & 0xff;
  let b = color & 0xff;
  r = Math.max(0, Math.min(255, r - amount));
  gr = Math.max(0, Math.min(255, gr - amount));
  b = Math.max(0, Math.min(255, b - amount));
  return (r << 16) | (gr << 8) | b;
}

// ---------------------------------------------------------------------------
// Item renderers
// ---------------------------------------------------------------------------

export function renderCampfire(g: G, x: number, y: number, _rot = 0) {
  // Stone ring base
  diamond(g, x, y, 0x666666);
  // Embers
  diamond(g, x, y, 0x8b2500, 0.7);
  // Fire — stacked triangles
  g.fillStyle(0xff4500, 0.9);
  g.fillTriangle(x, y - 20, x - 6, y - 2, x + 6, y - 2);
  g.fillStyle(0xff8c00, 0.9);
  g.fillTriangle(x, y - 16, x - 4, y - 4, x + 4, y - 4);
  g.fillStyle(0xffcc00, 0.8);
  g.fillTriangle(x, y - 12, x - 2, y - 5, x + 2, y - 5);
  // Sparks
  g.fillStyle(0xffee88, 0.6);
  g.fillCircle(x - 4, y - 18, 1);
  g.fillCircle(x + 3, y - 22, 1);
}

export function renderTent(g: G, x: number, y: number, rot = 0) {
  diamond(g, x, y, 0x2a5c25, 0.5);
  const h = 28;
  // Tent body
  g.fillStyle(0xc4a46c, 1);
  g.fillTriangle(x, y - h, x - HW, y, x + HW, y);
  g.fillStyle(0x9e8456, 1);
  g.fillTriangle(x, y - h, x - HW, y, x, y + HH);
  g.fillStyle(0xb08e50, 1);
  g.fillTriangle(x, y - h, x + HW, y, x, y + HH);
  // Opening — rotates based on direction
  const openings = [
    [x, y + 4, x - 6, y + 4, x, y - 8],   // 0: front (south)
    [x - 8, y - 2, x - 8, y - 2, x, y - 8], // 1: left (west)
    [x, y - HH, x - 6, y - HH + 4, x + 6, y - HH + 4], // 2: back (north)
    [x + 8, y - 2, x + 8, y - 2, x, y - 8],  // 3: right (east)
  ];
  const o = openings[rot % 4];
  g.fillStyle(0x3d2b1f, 1);
  g.fillTriangle(o[0], o[1], o[2], o[3], o[4], o[5]);
  // Pole tip
  g.fillStyle(0x8b7355, 1);
  g.fillCircle(x, y - h, 2);
}

export function renderFence(g: G, x: number, y: number, _rot = 0) {
  diamond(g, x, y, 0x3d6b35, 0.3);
  // Fence posts
  const postColor = 0x8b6914;
  const darkPost = 0x6b5010;
  // Left post
  g.fillStyle(postColor, 1);
  g.fillRect(x - HW + 4, y - 14, 3, 16);
  // Right post
  g.fillRect(x + HW - 7, y - 14, 3, 16);
  // Top rail
  g.fillStyle(darkPost, 1);
  g.lineStyle(2, postColor, 1);
  g.lineBetween(x - HW + 5, y - 12, x + HW - 5, y - 12);
  // Bottom rail
  g.lineBetween(x - HW + 5, y - 6, x + HW - 5, y - 6);
}

export function renderBush(g: G, x: number, y: number, _rot = 0) {
  // Shadow
  g.fillStyle(0x2a5c25, 0.4);
  g.fillEllipse(x, y + 2, 24, 10);
  // Bush body
  g.fillStyle(0x2d8a2d, 1);
  g.fillEllipse(x, y - 6, 26, 16);
  g.fillStyle(0x3aaa3a, 1);
  g.fillEllipse(x - 4, y - 9, 14, 12);
  g.fillEllipse(x + 5, y - 7, 16, 12);
  // Highlights
  g.fillStyle(0x4fc44f, 0.6);
  g.fillCircle(x - 3, y - 12, 3);
  g.fillCircle(x + 6, y - 10, 2);
}

export function renderTree(g: G, x: number, y: number, _rot = 0) {
  // Shadow
  g.fillStyle(0x1a4a1a, 0.4);
  g.fillEllipse(x + 4, y + 4, 20, 10);
  // Trunk
  g.fillStyle(0x6b4226, 1);
  g.fillRect(x - 3, y - 16, 6, 20);
  g.fillStyle(0x5a3620, 1);
  g.fillRect(x - 3, y - 16, 3, 20);
  // Canopy layers
  g.fillStyle(0x1a6b1a, 1);
  g.fillTriangle(x, y - 44, x - 16, y - 16, x + 16, y - 16);
  g.fillStyle(0x228b22, 1);
  g.fillTriangle(x, y - 38, x - 14, y - 18, x + 14, y - 18);
  g.fillStyle(0x2ea82e, 1);
  g.fillTriangle(x, y - 50, x - 12, y - 28, x + 12, y - 28);
  // Snow/highlights on tips
  g.fillStyle(0x44cc44, 0.5);
  g.fillCircle(x - 8, y - 24, 2);
  g.fillCircle(x + 6, y - 26, 2);
  g.fillCircle(x, y - 38, 2);
}

export function renderCottage(g: G, x: number, y: number, rot = 0) {
  isoBox(g, x, y, 20, 0xcd853f, 0xa06830, 0x8b5a28);
  // Roof
  g.fillStyle(0x8b0000, 1);
  g.fillTriangle(x, y - 36, x - HW - 2, y - 20, x + HW + 2, y - 20);
  g.fillStyle(0x6b0000, 1);
  g.fillTriangle(x, y - 36, x + HW + 2, y - 20, x + 4, y - 16);
  // Door and window positions rotate
  const doorPos = [
    { dx: -4, dy: -12, wdx: 8, wdy: -16 },   // 0: front
    { dx: -14, dy: -14, wdx: -14, wdy: -6 },  // 1: left
    { dx: -4, dy: -18, wdx: -12, wdy: -16 },  // 2: back
    { dx: 8, dy: -14, wdx: 8, wdy: -6 },      // 3: right
  ][rot % 4];
  g.fillStyle(0x5a3620, 1);
  g.fillRect(x + doorPos.dx, y + doorPos.dy, 8, 12);
  g.fillStyle(0x87ceeb, 0.7);
  g.fillRect(x + doorPos.wdx, y + doorPos.wdy, 6, 6);
  g.lineStyle(1, 0x5a3620, 1);
  g.strokeRect(x + doorPos.wdx, y + doorPos.wdy, 6, 6);
  // Chimney
  const chimneyX = rot % 2 === 0 ? 10 : -12;
  g.fillStyle(0x696969, 1);
  g.fillRect(x + chimneyX, y - 42, 5, 10);
}

export function renderWorkshop(g: G, x: number, y: number, _rot = 0) {
  // Large base
  isoBox(g, x, y, 24, 0xb8860b, 0x8b6508, 0x7a5806);
  // Roof (flat-ish)
  g.fillStyle(0x555555, 1);
  g.beginPath();
  g.moveTo(x, y - HH - 28);
  g.lineTo(x + HW + 4, y - 24);
  g.lineTo(x, y + HH - 24);
  g.lineTo(x - HW - 4, y - 24);
  g.closePath();
  g.fillPath();
  // Gear symbol
  g.fillStyle(0x888888, 1);
  g.fillCircle(x, y - 14, 6);
  g.fillStyle(0xb8860b, 1);
  g.fillCircle(x, y - 14, 3);
  // Anvil shape
  g.fillStyle(0x444444, 1);
  g.fillRect(x - 12, y - 6, 10, 4);
  g.fillRect(x - 10, y - 10, 6, 4);
}

export function renderGarden(g: G, x: number, y: number, _rot = 0) {
  // Soil base
  diamond(g, x, y, 0x5a3a1a);
  // Dirt rows
  g.lineStyle(2, 0x4a2a10, 0.8);
  g.lineBetween(x - 16, y - 4, x + 16, y - 4);
  g.lineBetween(x - 12, y + 2, x + 12, y + 2);
  // Small plants
  g.fillStyle(0x32cd32, 1);
  g.fillCircle(x - 10, y - 8, 3);
  g.fillCircle(x, y - 6, 4);
  g.fillCircle(x + 10, y - 7, 3);
  g.fillCircle(x - 6, y, 3);
  g.fillCircle(x + 6, y - 1, 3);
  // Flowers
  g.fillStyle(0xff6347, 1);
  g.fillCircle(x - 10, y - 10, 2);
  g.fillStyle(0xffff00, 1);
  g.fillCircle(x + 10, y - 9, 2);
  g.fillStyle(0xff69b4, 1);
  g.fillCircle(x, y - 9, 2);
}

export function renderTrainingGround(g: G, x: number, y: number, _rot = 0) {
  // Arena floor
  diamond(g, x, y, 0xc4a46c);
  // Ring border
  g.lineStyle(2, 0x8b7355, 1);
  g.beginPath();
  g.moveTo(x, y - HH + 4);
  g.lineTo(x + HW - 4, y);
  g.lineTo(x, y + HH - 4);
  g.lineTo(x - HW + 4, y);
  g.closePath();
  g.strokePath();
  // Training dummy
  g.fillStyle(0x8b6914, 1);
  g.fillRect(x - 2, y - 22, 4, 16);
  // Cross bar
  g.fillRect(x - 8, y - 18, 16, 3);
  // Head
  g.fillStyle(0xdeb887, 1);
  g.fillCircle(x, y - 24, 4);
  // Sword on ground
  g.lineStyle(2, 0xaaaaaa, 0.8);
  g.lineBetween(x + 8, y - 2, x + 18, y - 8);
  g.lineStyle(2, 0x8b6914, 1);
  g.lineBetween(x + 10, y - 2, x + 14, y - 6);
}

export function renderObservatory(g: G, x: number, y: number, _rot = 0) {
  // Base tower
  isoColumn(g, x, y, 30, 14, 8, 0x4169e1, 40);
  // Dome
  g.fillStyle(0x6495ed, 1);
  g.fillEllipse(x, y - 34, 24, 16);
  g.fillStyle(0x4169e1, 1);
  g.fillEllipse(x, y - 30, 28, 12);
  // Telescope slit
  g.fillStyle(0x1a1a4a, 1);
  g.fillRect(x - 1, y - 40, 3, 12);
  // Telescope
  g.lineStyle(2, 0xaaaaaa, 1);
  g.lineBetween(x + 1, y - 36, x + 14, y - 46);
  // Stars
  g.fillStyle(0xffff88, 0.6);
  g.fillCircle(x + 12, y - 50, 1.5);
  g.fillCircle(x - 8, y - 44, 1);
}

export function renderStonePath(g: G, x: number, y: number, _rot = 0) {
  // Base
  diamond(g, x, y, 0x808080);
  // Stones
  g.fillStyle(0x999999, 1);
  g.fillEllipse(x - 6, y - 2, 12, 6);
  g.fillEllipse(x + 8, y + 1, 10, 6);
  g.fillStyle(0x707070, 1);
  g.fillEllipse(x + 2, y - 5, 10, 5);
  g.fillEllipse(x - 4, y + 4, 8, 5);
  // Gaps
  g.lineStyle(1, 0x606060, 0.5);
  g.lineBetween(x - 2, y - 6, x - 1, y + 6);
  g.lineBetween(x - 10, y, x + 10, y - 1);
}

export function renderFlowerBed(g: G, x: number, y: number, _rot = 0) {
  // Soil
  diamond(g, x, y, 0x5a3a1a, 0.8);
  // Stems
  g.lineStyle(1, 0x228b22, 1);
  g.lineBetween(x - 10, y - 2, x - 10, y - 14);
  g.lineBetween(x - 2, y, x - 2, y - 16);
  g.lineBetween(x + 6, y - 1, x + 6, y - 12);
  g.lineBetween(x + 12, y - 3, x + 12, y - 10);
  // Flower heads
  g.fillStyle(0xff69b4, 1);
  g.fillCircle(x - 10, y - 15, 4);
  g.fillStyle(0xffff44, 1);
  g.fillCircle(x - 2, y - 17, 4);
  g.fillStyle(0xff4444, 1);
  g.fillCircle(x + 6, y - 13, 3);
  g.fillStyle(0xcc66ff, 1);
  g.fillCircle(x + 12, y - 11, 3);
  // Centers
  g.fillStyle(0xffcc00, 1);
  g.fillCircle(x - 10, y - 15, 1.5);
  g.fillCircle(x - 2, y - 17, 1.5);
  g.fillCircle(x + 6, y - 13, 1.5);
  g.fillCircle(x + 12, y - 11, 1.5);
}

export function renderFountain(g: G, x: number, y: number, _rot = 0) {
  // Base pool
  g.fillStyle(0x4fc3f7, 0.5);
  diamond(g, x, y, 0x4fc3f7, 0.5);
  // Stone rim
  g.lineStyle(3, 0x888888, 1);
  g.beginPath();
  g.moveTo(x, y - HH);
  g.lineTo(x + HW, y);
  g.lineTo(x, y + HH);
  g.lineTo(x - HW, y);
  g.closePath();
  g.strokePath();
  // Center pillar
  g.fillStyle(0x999999, 1);
  g.fillRect(x - 3, y - 24, 6, 20);
  // Bowl
  g.fillStyle(0xaaaaaa, 1);
  g.fillEllipse(x, y - 16, 16, 6);
  // Water streams
  g.lineStyle(1.5, 0x88ccff, 0.8);
  g.beginPath();
  g.moveTo(x - 2, y - 24);
  g.lineTo(x - 10, y - 10);
  g.moveTo(x + 2, y - 24);
  g.lineTo(x + 10, y - 10);
  g.strokePath();
  // Top spout
  g.fillStyle(0x88ddff, 0.6);
  g.fillCircle(x, y - 26, 3);
  // Water surface
  g.fillStyle(0x66bbee, 0.4);
  g.fillEllipse(x, y, 20, 8);
}

export function renderWatchtower(g: G, x: number, y: number, _rot = 0) {
  // Base
  isoBox(g, x, y, 12, 0x696969, 0x555555, 0x484848);
  // Tower shaft
  g.fillStyle(0x666666, 1);
  g.fillRect(x - 6, y - 44, 12, 32);
  g.fillStyle(0x555555, 1);
  g.fillRect(x - 6, y - 44, 6, 32);
  // Platform
  g.fillStyle(0x777777, 1);
  g.fillRect(x - 10, y - 48, 20, 4);
  // Crenellations
  g.fillStyle(0x888888, 1);
  g.fillRect(x - 10, y - 52, 4, 4);
  g.fillRect(x - 2, y - 52, 4, 4);
  g.fillRect(x + 6, y - 52, 4, 4);
  // Flag
  g.lineStyle(1, 0x8b6914, 1);
  g.lineBetween(x + 6, y - 52, x + 6, y - 64);
  g.fillStyle(0xcc0000, 1);
  g.fillTriangle(x + 6, y - 64, x + 6, y - 56, x + 16, y - 60);
}

export function renderCrystalSpire(g: G, x: number, y: number, _rot = 0) {
  // Base glow
  g.fillStyle(0x88ddff, 0.3);
  g.fillEllipse(x, y + 2, 20, 10);
  // Crystal body
  g.fillStyle(0x88ddff, 0.8);
  g.fillTriangle(x, y - 42, x - 8, y, x + 8, y);
  g.fillStyle(0xaaeeff, 0.9);
  g.fillTriangle(x, y - 42, x - 8, y, x, y - 4);
  // Facets
  g.lineStyle(1, 0xccf8ff, 0.6);
  g.lineBetween(x, y - 42, x - 4, y - 10);
  g.lineBetween(x, y - 42, x + 4, y - 10);
  // Sparkle
  g.fillStyle(0xffffff, 0.9);
  g.fillCircle(x - 2, y - 28, 2);
  g.fillCircle(x + 3, y - 18, 1.5);
}

export function renderDiamondGate(g: G, x: number, y: number, _rot = 0) {
  // Left pillar
  g.fillStyle(0x88aabb, 1);
  g.fillRect(x - HW + 2, y - 30, 8, 32);
  g.fillStyle(0x6688aa, 1);
  g.fillRect(x - HW + 2, y - 30, 4, 32);
  // Right pillar
  g.fillStyle(0x88aabb, 1);
  g.fillRect(x + HW - 10, y - 30, 8, 32);
  g.fillStyle(0x6688aa, 1);
  g.fillRect(x + HW - 10, y - 30, 4, 32);
  // Arch
  g.lineStyle(3, 0xaaeeff, 1);
  g.beginPath();
  g.arc(x, y - 30, HW - 6, Math.PI, 0, false);
  g.strokePath();
  // Diamond gem on top
  g.fillStyle(0xbbf0ff, 1);
  g.fillTriangle(x, y - 44, x - 6, y - 36, x + 6, y - 36);
  g.fillStyle(0x88ddff, 1);
  g.fillTriangle(x, y - 30, x - 6, y - 36, x + 6, y - 36);
  // Sparkle
  g.fillStyle(0xffffff, 0.8);
  g.fillCircle(x - 2, y - 38, 1.5);
}

export function renderIceGarden(g: G, x: number, y: number, _rot = 0) {
  // Frozen ground
  diamond(g, x, y, 0xbbddee, 0.6);
  // Ice crystals
  g.fillStyle(0xccf2ff, 0.8);
  g.fillTriangle(x - 10, y - 2, x - 14, y - 16, x - 6, y - 2);
  g.fillTriangle(x + 4, y, x, y - 20, x + 8, y);
  g.fillTriangle(x + 14, y - 2, x + 10, y - 14, x + 18, y - 2);
  // Highlights
  g.fillStyle(0xffffff, 0.6);
  g.fillCircle(x - 10, y - 10, 1.5);
  g.fillCircle(x + 4, y - 12, 1.5);
  g.fillCircle(x + 14, y - 8, 1);
  // Frozen flowers
  g.fillStyle(0x99ccdd, 1);
  g.fillCircle(x - 4, y - 6, 3);
  g.fillCircle(x + 10, y - 5, 2.5);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Rotation: 0 = default, 1 = 90° CW, 2 = 180°, 3 = 270° CW.
 * For isometric, rotation flips which face is "front".
 * Renderers that care about facing will use this; symmetric items ignore it.
 */
const RENDERERS: Record<string, (g: G, x: number, y: number, rot: number) => void> = {
  campfire: renderCampfire,
  tent: renderTent,
  fence: renderFence,
  bush: renderBush,
  tree: renderTree,
  cottage: renderCottage,
  workshop: renderWorkshop,
  garden: renderGarden,
  training_ground: renderTrainingGround,
  observatory: renderObservatory,
  stone_path: renderStonePath,
  flower_bed: renderFlowerBed,
  fountain: renderFountain,
  watchtower: renderWatchtower,
  crystal_spire: renderCrystalSpire,
  diamond_gate: renderDiamondGate,
  ice_garden: renderIceGarden,
};

/** Render a building using its custom renderer, or fall back to a colored box. */
export function renderBuilding(g: G, x: number, y: number, itemId: string, fallbackColor: number, rotation = 0) {
  const renderer = RENDERERS[itemId];
  if (renderer) {
    renderer(g, x, y, rotation);
  } else {
    isoBox(g, x, y, 16, fallbackColor, adjustBrightness(fallbackColor, 30), adjustBrightness(fallbackColor, 50));
  }
}
