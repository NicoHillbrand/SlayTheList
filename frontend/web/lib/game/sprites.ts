/**
 * Sprite asset registry.
 * Maps catalog item IDs to image paths.
 * When an entry exists here, the renderer uses the sprite instead of procedural graphics.
 */

export interface SpriteAsset {
  /** Path relative to /assets/ */
  path: string;
  /** Sprite width to render at (in game pixels) */
  width: number;
  /** Sprite height to render at (in game pixels) */
  height: number;
  /** Y offset from tile center (negative = up) — use to align the base of the sprite with the tile */
  offsetY: number;
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
    width: 250, height: 250, offsetY: -36,
  },
  sapling: {
    path: "kenney_nature-kit/Isometric/tree_simple_NE.png",
    width: 210, height: 210, offsetY: -16,
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
    width: 230, height: 250, offsetY: -36,
  },
  detailed_tree: {
    path: "kenney_nature-kit/Isometric/tree_detailed_NE.png",
    width: 250, height: 250, offsetY: -34,
  },
  fat_tree: {
    path: "kenney_nature-kit/Isometric/tree_fat_NE.png",
    width: 260, height: 250, offsetY: -32,
  },
  palm_tree: {
    path: "kenney_nature-kit/Isometric/tree_palm_NE.png",
    width: 240, height: 250, offsetY: -34,
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
  // ---- Sketch desert pack (more kenney/kenney_sketch-desert) ----
  // Source PNGs are 256x352 (taller than wide). Render at the same 4:5.5
  // ratio so the structures aren't squashed.
  desert_walls_corner: {
    path: "more kenney/kenney_sketch-desert/Tiles/walls_corner_E.png",
    width: 128, height: 176, offsetY: -52,
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
  td_catapult: {
    path: "more kenney/kenney_tower-defense-kit/Previews/weapon-catapult.png",
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
  market_stall: {
    path: "more kenney/kenney_fantasy-town-kit_2.0/Previews/stall.png",
    width: 80, height: 80, offsetY: -16,
  },
  stall_green: {
    path: "more kenney/kenney_fantasy-town-kit_2.0/Previews/stall-green.png",
    width: 80, height: 80, offsetY: -16,
  },
  stall_red: {
    path: "more kenney/kenney_fantasy-town-kit_2.0/Previews/stall-red.png",
    width: 80, height: 80, offsetY: -16,
  },
  fountain_round: {
    path: "more kenney/kenney_fantasy-town-kit_2.0/Previews/fountain-round.png",
    width: 80, height: 80, offsetY: -12,
  },
  fountain_square: {
    path: "more kenney/kenney_fantasy-town-kit_2.0/Previews/fountain-square.png",
    width: 80, height: 80, offsetY: -12,
  },
  cart: {
    path: "more kenney/kenney_fantasy-town-kit_2.0/Previews/cart.png",
    width: 72, height: 72, offsetY: -14,
  },
  cart_high: {
    path: "more kenney/kenney_fantasy-town-kit_2.0/Previews/cart-high.png",
    width: 72, height: 72, offsetY: -16,
  },
  lantern: {
    path: "more kenney/kenney_fantasy-town-kit_2.0/Previews/lantern.png",
    width: 56, height: 56, offsetY: -14,
  },
  hedge: {
    path: "more kenney/kenney_fantasy-town-kit_2.0/Previews/hedge.png",
    width: 64, height: 64, offsetY: -10,
  },
  hedge_large: {
    path: "more kenney/kenney_fantasy-town-kit_2.0/Previews/hedge-large.png",
    width: 64, height: 64, offsetY: -12,
  },
  banner_red: {
    path: "more kenney/kenney_fantasy-town-kit_2.0/Previews/banner-red.png",
    width: 56, height: 56, offsetY: -14,
  },
  banner_green: {
    path: "more kenney/kenney_fantasy-town-kit_2.0/Previews/banner-green.png",
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



