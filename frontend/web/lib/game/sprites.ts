/**
 * Sprite asset registry.
 * Maps catalog item IDs to image paths.
 * When an entry exists here, the renderer uses the sprite instead of procedural graphics.
 */

/** One row of overlapping cube copies — used by walls and (in pairs) corners. */
export interface TileRow {
  count: number;
  stepX: number;
  stepY: number;
  shiftX?: number;
  shiftY?: number;
}

export interface SpriteAsset {
  /** Path relative to /assets/ */
  path: string;
  /** Sprite width to render at (in game pixels) */
  width: number;
  /** Sprite height to render at (in game pixels) */
  height: number;
  /** Y offset from tile center (negative = up) — use to align the base of the sprite with the tile */
  offsetY: number;
  /** Render this asset as multiple overlapping copies offset by
   *  (stepX, stepY) in screen pixels. Used to fake a continuous wall by
   *  packing many small cube sprites into one tile so their tops blend.
   *  `shiftX` / `shiftY` move the centered row by N screen pixels — useful
   *  for placing the row on a tile edge instead of through the center.
   *  Under R-key rotation `shiftX`'s sign flips alongside `stepY`. */
  tile?: TileRow;
  /** Render this asset as several `tile`-style rows in one placement — used
   *  for corner pieces that combine half-walls in two iso directions.
   *  If both `tile` and `rows` are set, only `rows` is used. */
  rows?: TileRow[];
  /** Extra screen-pixel offsets applied per rotation (rot 0..3). Iso rotation
   *  rotates the shape around tile center, which is geometrically correct
   *  but doesn't always land the rotated shape at a natural-looking spot.
   *  These per-rotation nudges let corners sit at their respective diamond
   *  corner cardinals without changing the base config. */
  rotationShifts?: Array<{ x: number; y: number }>;
}

/** Return all the cube-rows for an asset (1 row for simple walls, N for corners). */
export function getAssetRows(asset: SpriteAsset): TileRow[] {
  if (asset.rows) return asset.rows;
  if (asset.tile) return [asset.tile];
  return [{ count: 1, stepX: 0, stepY: 0 }];
}

/**
 * Registry of available sprite assets.
 * Add entries here as you generate/acquire new assets.
 * The key is the catalog item ID.
 */
export const SPRITE_ASSETS: Record<string, SpriteAsset> = {
  tree: {
    path: "aigen/tree test.png",
    width: 56,
    height: 72,
    offsetY: -20,
  },
  // Kenney Nature Kit isometric props (CC0). Source PNGs are 512x512 with the
  // visible content centered; the displayed width/height scales the whole
  // canvas down. offsetY is tuned so the sprite's visible base lands near the
  // tile center — tweak per-item if alignment looks off.
  oak_tree: {
    path: "kenney_nature-kit/Isometric/tree_default_NE.png",
    width: 230, height: 230, offsetY: -28,
  },
  pine_tree: {
    path: "kenney_nature-kit/Isometric/tree_pineDefaultA_NE.png",
    width: 250, height: 250, offsetY: -30,
  },
  sapling: {
    path: "kenney_nature-kit/Isometric/tree_simple_NE.png",
    width: 210, height: 210, offsetY: -20,
  },
  maple_tree: {
    path: "kenney_nature-kit/Isometric/tree_oak_NE.png",
    width: 240, height: 240, offsetY: -30,
  },
  blocks_tree: {
    path: "kenney_nature-kit/Isometric/tree_blocks_NE.png",
    width: 230, height: 230, offsetY: -26,
  },
  cone_tree: {
    path: "kenney_nature-kit/Isometric/tree_cone_NE.png",
    width: 230, height: 250, offsetY: -30,
  },
  detailed_tree: {
    path: "kenney_nature-kit/Isometric/tree_detailed_NE.png",
    width: 250, height: 250, offsetY: -28,
  },
  fat_tree: {
    path: "kenney_nature-kit/Isometric/tree_fat_NE.png",
    width: 260, height: 250, offsetY: -26,
  },
  palm_tree: {
    path: "kenney_nature-kit/Isometric/tree_palm_NE.png",
    width: 240, height: 250, offsetY: -28,
  },
  bent_palm: {
    path: "kenney_nature-kit/Isometric/tree_palmBend_NE.png",
    width: 250, height: 240, offsetY: -30,
  },
  tall_palm: {
    path: "kenney_nature-kit/Isometric/tree_palmTall_NE.png",
    width: 250, height: 300, offsetY: -52,
  },
  round_pine: {
    path: "kenney_nature-kit/Isometric/tree_pineRoundA_NE.png",
    width: 230, height: 250, offsetY: -36,
  },
  small_pine: {
    path: "kenney_nature-kit/Isometric/tree_pineSmallA_NE.png",
    width: 200, height: 210, offsetY: -18,
  },
  tall_pine: {
    path: "kenney_nature-kit/Isometric/tree_pineTallA_NE.png",
    width: 250, height: 300, offsetY: -52,
  },
  plateau_tree: {
    path: "kenney_nature-kit/Isometric/tree_plateau_NE.png",
    width: 275, height: 250, offsetY: -32,
  },
  small_tree: {
    path: "kenney_nature-kit/Isometric/tree_small_NE.png",
    width: 200, height: 210, offsetY: -16,
  },
  tall_tree: {
    path: "kenney_nature-kit/Isometric/tree_tall_NE.png",
    width: 230, height: 300, offsetY: -52,
  },
  thin_tree: {
    path: "kenney_nature-kit/Isometric/tree_thin_NE.png",
    width: 200, height: 250, offsetY: -36,
  },
  fall_oak: {
    path: "kenney_nature-kit/Isometric/tree_default_fall_NE.png",
    width: 230, height: 230, offsetY: -28,
  },
  fall_maple: {
    path: "kenney_nature-kit/Isometric/tree_oak_fall_NE.png",
    width: 240, height: 240, offsetY: -30,
  },
  dark_oak: {
    path: "kenney_nature-kit/Isometric/tree_default_dark_NE.png",
    width: 230, height: 230, offsetY: -28,
  },
  leafy_bush: {
    path: "kenney_nature-kit/Isometric/plant_bushDetailed_NE.png",
    width: 110, height: 110, offsetY: -13,
  },
  yellow_flowers: {
    path: "kenney_nature-kit/Isometric/flower_yellowB_NE.png",
    width: 90, height: 90, offsetY: -11,
  },
  boulder: {
    path: "kenney_nature-kit/Isometric/stone_largeA_NE.png",
    width: 130, height: 130, offsetY: -16,
  },
  grass_tuft: {
    path: "kenney_nature-kit/Isometric/grass_large_NE.png",
    width: 100, height: 100, offsetY: -12,
  },
  // Stone / rock wall cubes. Each placement renders 7 small cube copies
  // stepping along an iso diagonal (screen ratio 2:1) so adjacent
  // placements visually merge into one continuous wall. The "_se"
  // variants step down-right instead of up-right; R-key rotation also
  // flips stepY's sign at render time, so either direction can be
  // turned into the other after placement.
  stone_wall_block: {
    path: "kenney_nature-kit/Isometric/cliff_block_stone_NE.png",
    width: 56, height: 56, offsetY: -2,
    tile: { count: 8, stepX: 4, stepY: -2, shiftX: 4, shiftY: -2 },
  },
  rock_wall_block: {
    path: "kenney_nature-kit/Isometric/cliff_block_rock_NE.png",
    width: 56, height: 56, offsetY: -2,
    tile: { count: 8, stepX: 4, stepY: -2, shiftX: 4, shiftY: -2 },
  },
  stone_wall_block_se: {
    path: "kenney_nature-kit/Isometric/cliff_block_stone_NE.png",
    width: 56, height: 56, offsetY: -2,
    // "Back" of an SE-going wall is up-LEFT (NW), not up-right — so shiftX
    // is negative here while NE walls have positive shiftX. Under R-rotation
    // shiftX flips sign to keep "shift toward back" consistent. shiftY -4
    // (instead of -2) puts the wall's middle at the same screen-y as the
    // corner piece's SE arm so the two render flush when placed adjacent.
    tile: { count: 8, stepX: 4, stepY: 2, shiftX: -4, shiftY: -4 },
  },
  rock_wall_block_se: {
    path: "kenney_nature-kit/Isometric/cliff_block_rock_NE.png",
    width: 56, height: 56, offsetY: -2,
    tile: { count: 8, stepX: 4, stepY: 2, shiftX: -4, shiftY: -4 },
  },
  // Corner pieces: NE half-wall (4 cubes ending at the same position the
  // ↗ wall's back-cube would land) + SE half-wall (4 cubes ending where
  // the ↘ wall's front-cube would land). The two halves meet at the
  // top-back of the tile and visually overlap thanks to the cube tops.
  // Four hand-tuned corner sprites per material, one per diamond corner.
  // Each is a 90° iso rotation of the S-corner shape — same cube count,
  // recomputed step/shift to land at the rotated positions. Each has its
  // own junction and arm directions:
  //   S-corner: junction (+2, -3), arms run NE and (SE-with-back-up-left).
  //   W-corner: junction (+6, +1).
  //   N-corner: junction (-2, +3).
  //   E-corner: junction (-6, -1).
  stone_corner_s: {
    path: "kenney_nature-kit/Isometric/cliff_block_stone_NE.png",
    width: 56, height: 56, offsetY: -2,
    rows: [
      { count: 5, stepX: 4,  stepY: -2, shiftX: 10, shiftY: -5 },
      { count: 6, stepX: 4,  stepY: 2,  shiftX: -8, shiftY: -6 },
    ],
  },
  stone_corner_w: {
    path: "kenney_nature-kit/Isometric/cliff_block_stone_NE.png",
    width: 56, height: 56, offsetY: -2,
    // West (left of diamond) corner: NE wall back half (i=3..i=7) plus
    // SE wall front half (i=5..i=7). Junction at the wall-crossing point
    // (+2, -3) so each arm sits exactly on top of the cubes of a normal
    // NE/SE wall placed in the same tile. Cubes on the right side.
    rows: [
      { count: 5, stepX: 4, stepY: -2, shiftX: 10, shiftY: -5 }, // NE wall i=3..i=7
      { count: 3, stepX: 4, stepY: 2,  shiftX: 6,  shiftY: 1  }, // SE wall i=5..i=7
    ],
  },
  stone_corner_n: {
    path: "kenney_nature-kit/Isometric/cliff_block_stone_NE.png",
    width: 56, height: 56, offsetY: -2,
    // North corner: NE wall front half (i=0..i=3) + SE wall front half
    // (i=5..i=7). Both arms terminate at the wall-crossing (+2, -3) and
    // extend down-left / down-right — the V-shape opening downward.
    rows: [
      { count: 4, stepX: 4, stepY: -2, shiftX: -4, shiftY: 2 }, // NE wall i=0..i=3
      { count: 3, stepX: 4, stepY: 2,  shiftX: 6,  shiftY: 1 }, // SE wall i=5..i=7
    ],
  },
  stone_corner_e: {
    path: "kenney_nature-kit/Isometric/cliff_block_stone_NE.png",
    width: 56, height: 56, offsetY: -2,
    // East corner: NE wall front half (i=0..i=3) + SE wall back half
    // (i=0..i=5). Junction at the wall-crossing (+2, -3); cubes on the
    // LEFT side of tile. Mirror of W corner.
    rows: [
      { count: 4, stepX: 4, stepY: -2, shiftX: -4, shiftY: 2  }, // NE wall i=0..i=3
      { count: 6, stepX: 4, stepY: 2,  shiftX: -8, shiftY: -6 }, // SE wall i=0..i=5
    ],
  },
  rock_corner_s: {
    path: "kenney_nature-kit/Isometric/cliff_block_rock_NE.png",
    width: 56, height: 56, offsetY: -2,
    rows: [
      { count: 5, stepX: 4,  stepY: -2, shiftX: 10, shiftY: -5 },
      { count: 6, stepX: 4,  stepY: 2,  shiftX: -8, shiftY: -6 },
    ],
  },
  rock_corner_w: {
    path: "kenney_nature-kit/Isometric/cliff_block_rock_NE.png",
    width: 56, height: 56, offsetY: -2,
    rows: [
      { count: 5, stepX: 4, stepY: -2, shiftX: 10, shiftY: -5 },
      { count: 3, stepX: 4, stepY: 2,  shiftX: 6,  shiftY: 1  },
    ],
  },
  rock_corner_n: {
    path: "kenney_nature-kit/Isometric/cliff_block_rock_NE.png",
    width: 56, height: 56, offsetY: -2,
    rows: [
      { count: 4, stepX: 4, stepY: -2, shiftX: -4, shiftY: 2 },
      { count: 3, stepX: 4, stepY: 2,  shiftX: 6,  shiftY: 1 },
    ],
  },
  rock_corner_e: {
    path: "kenney_nature-kit/Isometric/cliff_block_rock_NE.png",
    width: 56, height: 56, offsetY: -2,
    rows: [
      { count: 4, stepX: 4, stepY: -2, shiftX: -4, shiftY: 2  },
      { count: 6, stepX: 4, stepY: 2,  shiftX: -8, shiftY: -6 },
    ],
  },
  // ---- Tower defense kit (more kenney/kenney_tower-defense-kit) ----
  // All preview PNGs are 64x64 squares. The "build-f" variants are fully
  // assembled towers (bottom + middle + roof + crown). Render square — the
  // earlier 64x128 was a 2x vertical stretch.
  tower_square: {
    path: "more kenney/kenney_tower-defense-kit/Previews/tower-square-build-f.png",
    width: 80, height: 80, offsetY: -20,
  },
  tower_round: {
    path: "more kenney/kenney_tower-defense-kit/Previews/tower-round-build-f.png",
    width: 80, height: 80, offsetY: -20,
  },
  tower_square_short: {
    path: "more kenney/kenney_tower-defense-kit/Previews/tower-square-build-c.png",
    width: 72, height: 72, offsetY: -16,
  },
  tower_round_short: {
    path: "more kenney/kenney_tower-defense-kit/Previews/tower-round-build-c.png",
    width: 72, height: 72, offsetY: -16,
  },
  // ---- Modular buildings (more kenney/kenney_modular-buildings) ----
  // Pre-assembled "sample" houses & towers — 64x64 squares.
  house_small: {
    path: "more kenney/kenney_modular-buildings/Previews/building-sample-house-a.png",
    width: 96, height: 96, offsetY: -24,
  },
  house_medium: {
    path: "more kenney/kenney_modular-buildings/Previews/building-sample-house-b.png",
    width: 96, height: 96, offsetY: -24,
  },
  house_large: {
    path: "more kenney/kenney_modular-buildings/Previews/building-sample-house-c.png",
    width: 96, height: 96, offsetY: -24,
  },
  apartment_a: {
    path: "more kenney/kenney_modular-buildings/Previews/building-sample-tower-a.png",
    width: 96, height: 96, offsetY: -28,
  },
  apartment_b: {
    path: "more kenney/kenney_modular-buildings/Previews/building-sample-tower-b.png",
    width: 96, height: 96, offsetY: -28,
  },
  apartment_c: {
    path: "more kenney/kenney_modular-buildings/Previews/building-sample-tower-c.png",
    width: 96, height: 96, offsetY: -28,
  },

  // ---- Fantasy town kit (more kenney/kenney_fantasy-town-kit_2.0) ----
  // 64x64 source PNGs; render slightly larger but keep the square ratio.
  fountain_round: {
    path: "more kenney/kenney_fantasy-town-kit_2.0/Previews/fountain-round.png",
    width: 80, height: 80, offsetY: -12,
  },
  lantern: {
    path: "more kenney/kenney_fantasy-town-kit_2.0/Previews/lantern.png",
    width: 56, height: 56, offsetY: -14,
  },
  rock_large: {
    path: "more kenney/kenney_fantasy-town-kit_2.0/Previews/rock-large.png",
    width: 72, height: 72, offsetY: -10,
  },
};

/**
 * Notes on the Kenney packs we're using.
 *
 * Working packs (the per-piece previews are clean isometric renders on
 * transparent backgrounds and look good in the shop and on the field):
 *   - kenney_nature-kit/Isometric    — 512x512 source. Render ~200-260px.
 *   - kenney_tower-defense-kit       — 64x64 previews. KEEP SQUARE — earlier
 *     64x128 was a 2x vertical stretch. The "build-f" variant of each tower
 *     is a fully assembled tower; the "top-a/b/c" variants are just the
 *     crown/battlement and look like a tiny disc on its own.
 *   - kenney_fantasy-town-kit_2.0    — 64x64 previews, render ~64-80px.
 *   - kenney_modular-buildings       — 64x64 previews; the
 *     "building-sample-*" entries are pre-assembled houses/towers.
 *   - kenney_sketch-desert/Tiles     — 256x352 source (taller than wide).
 *     Use a width:height of 4:5.5 to avoid squashing. NOTE: hand-drawn
 *     sketch style; lines are dark, so they may look faint over very dark UI.
 *
 * Untested/known-quirky:
 *   - kenney_castle-kit              — individual pieces (walls, towers,
 *     roofs); no pre-assembled samples in the Previews folder we want.
 *   - kenney_building-kit            — sci-fi modular plating; very piece-
 *     centric, bad for "drop one piece per tile" placement.
 *   - kenney_food-kit, kenney_mini-arena, kenney_space-station-kit,
 *     kenney_survival-kit, kenney_sketch-town-expansion — not yet
 *     experimented with; preview folders exist if we want to extend.
 */

/** Phaser texture keys use this prefix */
export const SPRITE_KEY_PREFIX = "building_";

export function spriteKey(itemId: string): string {
  return `${SPRITE_KEY_PREFIX}${itemId}`;
}

export function hasSprite(itemId: string): boolean {
  return itemId in SPRITE_ASSETS;
}

/**
 * Ground tile sprites (Kenney isometric landscape pack — CC0).
 * Each source PNG is 132x83 with the diamond face at the top (132x66) and
 * a ~17px depth strip below. We render at TILE_WIDTH-wide, height scaled
 * proportionally; offsetY pushes the sprite down so the diamond face center
 * aligns with the grid tile center.
 */
export const GROUND_TILES = {
  grass: "kenney/landscape/PNG/landscapeTiles_067.png",
  grassLight: "kenney/landscape/PNG/landscapeTiles_022.png",
} as const;

export const GROUND_TILE_KEY_PREFIX = "ground_";
export function groundTileKey(name: keyof typeof GROUND_TILES): string {
  return `${GROUND_TILE_KEY_PREFIX}${name}`;
}



