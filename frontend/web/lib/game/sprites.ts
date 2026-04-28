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
    width: 200, height: 200, offsetY: -45,
  },
  pine_tree: {
    path: "kenney_nature-kit/Isometric/tree_pineDefaultA_NE.png",
    width: 220, height: 220, offsetY: -54,
  },
  sapling: {
    path: "kenney_nature-kit/Isometric/tree_simple_NE.png",
    width: 180, height: 180, offsetY: -32,
  },
  leafy_bush: {
    path: "kenney_nature-kit/Isometric/plant_bushDetailed_NE.png",
    width: 110, height: 110, offsetY: -13,
  },
  red_flowers: {
    path: "kenney_nature-kit/Isometric/flower_redA_NE.png",
    width: 90, height: 90, offsetY: -10,
  },
  yellow_flowers: {
    path: "kenney_nature-kit/Isometric/flower_yellowB_NE.png",
    width: 90, height: 90, offsetY: -11,
  },
  purple_flowers: {
    path: "kenney_nature-kit/Isometric/flower_purpleC_NE.png",
    width: 90, height: 90, offsetY: -10,
  },
  red_mushroom: {
    path: "kenney_nature-kit/Isometric/mushroom_red_NE.png",
    width: 80, height: 80, offsetY: -9,
  },
  mushroom_cluster: {
    path: "kenney_nature-kit/Isometric/mushroom_tanGroup_NE.png",
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
};

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
