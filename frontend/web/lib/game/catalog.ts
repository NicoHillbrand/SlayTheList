/** Item catalog — all building definitions live here, not in the backend. */

import type { BaseCurrencyType } from "@slaythelist/contracts";

/** Temporary: while we're seeding the shop with new Kenney assets, treat
 *  every item as free. Flip back to `false` to restore the original prices. */
export const FREE_MODE = true;

/** Use this everywhere instead of `item.cost` so FREE_MODE flips a single switch. */
export function effectiveCost(item: CatalogItem): number {
  return FREE_MODE ? 0 : item.cost;
}

export interface CatalogItem {
  id: string;
  name: string;
  category: "building" | "decoration" | "terrain";
  /** Cost to unlock */
  cost: number;
  /** Which currency this costs (defaults to gold) */
  currency: BaseCurrencyType;
  /** Tile footprint (width x height in grid cells) */
  footprint: [number, number];
  /** Hex color used as placeholder until real sprites are added */
  color: string;
  /** Optional: minimum progression milestone to show in shop */
  unlockRequirement?: {
    stat: "totalTodosCompleted" | "currentDayStreak" | "longestDayStreak" | "totalHabitChecks" | "totalPredictions";
    value: number;
  };
}

export const CATALOG: CatalogItem[] = [
  // Terrain
  {
    id: "stone_path",
    name: "Stone Path",
    category: "terrain",
    cost: 1,
    currency: "gold",
    footprint: [1, 1],
    color: "#808080",
  },

  // ---- Modular buildings (full pre-assembled houses & apartment towers) ----
  // Always available — the entry-level building set.
  { id: "house_small",   name: "Small House",   category: "building", cost: 2, currency: "gold", footprint: [1, 1], color: "#c08060" },
  { id: "house_medium",  name: "Medium House",  category: "building", cost: 3, currency: "gold", footprint: [1, 1], color: "#a87050" },
  { id: "house_large",   name: "Large House",   category: "building", cost: 5, currency: "gold", footprint: [2, 2], color: "#806040" },
  { id: "apartment_a",   name: "Apartment A",   category: "building", cost: 4, currency: "gold", footprint: [1, 1], color: "#b88a4a" },
  { id: "apartment_b",   name: "Apartment B",   category: "building", cost: 4, currency: "gold", footprint: [1, 1], color: "#a87a3a" },
  { id: "apartment_c",   name: "Apartment C",   category: "building", cost: 5, currency: "gold", footprint: [1, 1], color: "#9a6a2a" },

  // ---- Towers (milestone-locked) ----
  // Short variants unlock at an early todo milestone; tall variants at a deeper one.
  { id: "tower_square_short", name: "Short Square Tower", category: "building", cost: 6,  currency: "gold", footprint: [1, 1], color: "#a05bd8",
    unlockRequirement: { stat: "totalTodosCompleted", value: 25 } },
  { id: "tower_round_short",  name: "Short Round Tower",  category: "building", cost: 6,  currency: "gold", footprint: [1, 1], color: "#d8665b",
    unlockRequirement: { stat: "totalTodosCompleted", value: 25 } },
  { id: "tower_square",       name: "Square Tower",       category: "building", cost: 15, currency: "gold", footprint: [1, 1], color: "#a0522d",
    unlockRequirement: { stat: "totalTodosCompleted", value: 100 } },
  { id: "tower_round",        name: "Round Tower",        category: "building", cost: 15, currency: "gold", footprint: [1, 1], color: "#228b22",
    unlockRequirement: { stat: "totalTodosCompleted", value: 100 } },

  // ---- Fantasy town: market + props ----
  { id: "fountain_round",   name: "Round Fountain",   category: "decoration", cost: 4, currency: "gold", footprint: [1, 1], color: "#88aacc" },
  { id: "lantern",       name: "Lantern",          category: "decoration", cost: 1, currency: "gold", footprint: [1, 1], color: "#ffd060" },
  { id: "rock_large",    name: "Stone Block",      category: "decoration", cost: 1, currency: "gold", footprint: [1, 1], color: "#8a8a8a" },

  // Nature Kit (Kenney) — cheap experimental decor for trying out the new sprites.
  { id: "oak_tree",        name: "Oak Tree",        category: "decoration", cost: 1, currency: "gold", footprint: [1, 1], color: "#3a8a3a" },
  { id: "pine_tree",       name: "Pine Tree",       category: "decoration", cost: 1, currency: "gold", footprint: [1, 1], color: "#2d6a2d" },
  { id: "sapling",         name: "Sapling",         category: "decoration", cost: 0, currency: "gold", footprint: [1, 1], color: "#5fa85f" },
  { id: "maple_tree",      name: "Maple Tree",      category: "decoration", cost: 2, currency: "gold", footprint: [1, 1], color: "#7ab84a" },
  { id: "blocks_tree",     name: "Voxel Tree",      category: "decoration", cost: 2, currency: "gold", footprint: [1, 1], color: "#4a8a4a" },
  { id: "cone_tree",       name: "Cone Tree",       category: "decoration", cost: 2, currency: "gold", footprint: [1, 1], color: "#3a7a4a" },
  { id: "detailed_tree",   name: "Detailed Tree",   category: "decoration", cost: 3, currency: "gold", footprint: [1, 1], color: "#3a8a3a" },
  { id: "fat_tree",        name: "Fat Tree",        category: "decoration", cost: 3, currency: "gold", footprint: [1, 1], color: "#5a9a4a" },
  { id: "palm_tree",       name: "Palm Tree",       category: "decoration", cost: 2, currency: "gold", footprint: [1, 1], color: "#6aaa4a" },
  { id: "bent_palm",       name: "Bent Palm",       category: "decoration", cost: 2, currency: "gold", footprint: [1, 1], color: "#6aaa4a" },
  { id: "tall_palm",       name: "Tall Palm",       category: "decoration", cost: 3, currency: "gold", footprint: [1, 1], color: "#5a9a3a",
    unlockRequirement: { stat: "totalHabitChecks", value: 50 } },
  { id: "round_pine",      name: "Round Pine",      category: "decoration", cost: 2, currency: "gold", footprint: [1, 1], color: "#2d6a3d" },
  { id: "small_pine",      name: "Small Pine",      category: "decoration", cost: 1, currency: "gold", footprint: [1, 1], color: "#2d6a3d" },
  { id: "tall_pine",       name: "Tall Pine",       category: "decoration", cost: 3, currency: "gold", footprint: [1, 1], color: "#1d5a2d",
    unlockRequirement: { stat: "totalHabitChecks", value: 50 } },
  { id: "plateau_tree",    name: "Plateau Tree",    category: "decoration", cost: 3, currency: "gold", footprint: [1, 1], color: "#4a8a3a" },
  { id: "small_tree",      name: "Small Tree",      category: "decoration", cost: 1, currency: "gold", footprint: [1, 1], color: "#5aa84a" },
  { id: "tall_tree",       name: "Tall Tree",       category: "decoration", cost: 3, currency: "gold", footprint: [1, 1], color: "#3a8a3a",
    unlockRequirement: { stat: "totalHabitChecks", value: 50 } },
  { id: "thin_tree",       name: "Thin Tree",       category: "decoration", cost: 2, currency: "gold", footprint: [1, 1], color: "#3a8a3a" },
  { id: "fall_oak",        name: "Autumn Oak",      category: "decoration", cost: 2, currency: "gold", footprint: [1, 1], color: "#d28a3a",
    unlockRequirement: { stat: "currentDayStreak", value: 7 } },
  { id: "fall_maple",      name: "Autumn Maple",    category: "decoration", cost: 2, currency: "gold", footprint: [1, 1], color: "#c87a3a",
    unlockRequirement: { stat: "currentDayStreak", value: 7 } },
  { id: "dark_oak",        name: "Dark Oak",        category: "decoration", cost: 2, currency: "gold", footprint: [1, 1], color: "#1a4a2a" },
  { id: "leafy_bush",      name: "Leafy Bush",      category: "decoration", cost: 0, currency: "gold", footprint: [1, 1], color: "#3a8a3a" },
  { id: "yellow_flowers",  name: "Yellow Flowers",  category: "decoration", cost: 0, currency: "gold", footprint: [1, 1], color: "#e8c838" },
  { id: "boulder",         name: "Boulder",         category: "decoration", cost: 1, currency: "gold", footprint: [1, 1], color: "#a8a8a8" },
  { id: "grass_tuft",      name: "Grass Tuft",      category: "decoration", cost: 0, currency: "gold", footprint: [1, 1], color: "#6aa852" },

  // ---- Wall cubes (overlap-style — adjacent placements visually tile.
  //      _se variants run the perpendicular iso diagonal; press R while
  //      placing to flip either one between the two directions.) ----
  { id: "stone_wall_block",    name: "Stone Wall ↗",     category: "building", cost: 2, currency: "gold", footprint: [1, 1], color: "#9a9a9a" },
  { id: "stone_wall_block_se", name: "Stone Wall ↘",     category: "building", cost: 2, currency: "gold", footprint: [1, 1], color: "#9a9a9a" },
  { id: "stone_wall_corner",   name: "Stone Wall Corner",category: "building", cost: 2, currency: "gold", footprint: [1, 1], color: "#9a9a9a" },
  { id: "rock_wall_block",     name: "Rock Wall ↗",      category: "building", cost: 2, currency: "gold", footprint: [1, 1], color: "#a87050" },
  { id: "rock_wall_block_se",  name: "Rock Wall ↘",      category: "building", cost: 2, currency: "gold", footprint: [1, 1], color: "#a87050" },
  { id: "rock_wall_corner",    name: "Rock Wall Corner", category: "building", cost: 2, currency: "gold", footprint: [1, 1], color: "#a87050" },
];

export function getCatalogItem(id: string): CatalogItem | undefined {
  return CATALOG.find((item) => item.id === id);
}
