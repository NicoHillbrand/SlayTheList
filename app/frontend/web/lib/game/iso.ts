/** Isometric coordinate conversion utilities. */

/** Tile dimensions in pixels */
export const TILE_WIDTH = 64;
export const TILE_HEIGHT = 32;

/** Grid size */
export const GRID_COLS = 20;
export const GRID_ROWS = 20;

/** Convert grid (col, row) to screen (x, y) — returns the center of the tile's top diamond point. */
export function gridToScreen(col: number, row: number): { x: number; y: number } {
  return {
    x: (col - row) * (TILE_WIDTH / 2),
    y: (col + row) * (TILE_HEIGHT / 2),
  };
}

/** Convert screen (x, y) to grid (col, row) — returns fractional grid coordinates. */
export function screenToGrid(x: number, y: number): { col: number; row: number } {
  return {
    col: (x / (TILE_WIDTH / 2) + y / (TILE_HEIGHT / 2)) / 2,
    row: (y / (TILE_HEIGHT / 2) - x / (TILE_WIDTH / 2)) / 2,
  };
}

/** Snap fractional grid coordinates to the nearest tile. */
export function snapToGrid(col: number, row: number): { col: number; row: number } {
  return {
    col: Math.round(col),
    row: Math.round(row),
  };
}

/** Check if a grid position is within bounds. */
export function isInBounds(col: number, row: number): boolean {
  return col >= 0 && col < GRID_COLS && row >= 0 && row < GRID_ROWS;
}

/** Isometric depth value for sorting — tiles further from camera draw first. */
export function isoDepth(col: number, row: number): number {
  return col + row;
}
