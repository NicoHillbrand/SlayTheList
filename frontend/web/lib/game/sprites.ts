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
};

/** Phaser texture keys use this prefix */
export const SPRITE_KEY_PREFIX = "building_";

export function spriteKey(itemId: string): string {
  return `${SPRITE_KEY_PREFIX}${itemId}`;
}

export function hasSprite(itemId: string): boolean {
  return itemId in SPRITE_ASSETS;
}
