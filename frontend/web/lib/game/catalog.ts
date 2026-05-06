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
  // Starter buildings — always available
  {
    id: "tower_square",
    name: "Square Tower",
    category: "building",
    cost: 15,
    currency: "gold",
    footprint: [1, 1],
    color: "#a0522d",
  },
  {
    id: "tower_round",
    name: "Round Tower",
    category: "building",
    cost: 15,
    currency: "gold",
    footprint: [1, 1],
    color: "#228b22",
  },
  {
    id: "garden",
    name: "Garden Plot",
    category: "building",
    cost: 15,
    currency: "gold",
    footprint: [2, 2],
    color: "#32cd32",
    unlockRequirement: { stat: "currentDayStreak", value: 7 },
  },
  {
    id: "training_ground",
    name: "Training Ground",
    category: "building",
    cost: 40,
    currency: "gold",
    footprint: [3, 3],
    color: "#daa520",
    unlockRequirement: { stat: "totalHabitChecks", value: 100 },
  },

  {
    id: "stone_path",
    name: "Stone Path",
    category: "terrain",
    cost: 1,
    currency: "gold",
    footprint: [1, 1],
    color: "#808080",
  },
  {
    id: "flower_bed",
    name: "Flower Bed",
    category: "decoration",
    cost: 5,
    currency: "gold",
    footprint: [1, 1],
    color: "#ff69b4",
  },
  {
    id: "fountain",
    name: "Fountain",
    category: "decoration",
    cost: 30,
    currency: "gold",
    footprint: [2, 2],
    color: "#4fc3f7",
    unlockRequirement: { stat: "longestDayStreak", value: 14 },
  },
  {
    id: "watchtower",
    name: "Watchtower",
    category: "building",
    cost: 75,
    currency: "gold",
    footprint: [2, 2],
    color: "#696969",
    unlockRequirement: { stat: "totalTodosCompleted", value: 100 },
  },

  // Diamond items — earned through streaks
  {
    id: "crystal_spire",
    name: "Crystal Spire",
    category: "building",
    cost: 5,
    currency: "diamonds",
    footprint: [1, 2],
    color: "#88ddff",
    unlockRequirement: { stat: "longestDayStreak", value: 7 },
  },
  {
    id: "diamond_gate",
    name: "Diamond Gate",
    category: "building",
    cost: 10,
    currency: "diamonds",
    footprint: [3, 1],
    color: "#aaeeff",
    unlockRequirement: { stat: "longestDayStreak", value: 14 },
  },
  {
    id: "ice_garden",
    name: "Ice Garden",
    category: "decoration",
    cost: 3,
    currency: "diamonds",
    footprint: [2, 2],
    color: "#ccf2ff",
    unlockRequirement: { stat: "longestDayStreak", value: 7 },
  },

  // ---- Modular buildings (full pre-assembled houses & apartment towers) ----
  { id: "house_small",   name: "Small House",   category: "building", cost: 2, currency: "gold", footprint: [1, 1], color: "#c08060" },
  { id: "house_medium",  name: "Medium House",  category: "building", cost: 3, currency: "gold", footprint: [1, 1], color: "#a87050" },
  { id: "house_large",   name: "Large House",   category: "building", cost: 5, currency: "gold", footprint: [2, 2], color: "#806040" },
  { id: "apartment_a",   name: "Apartment A",   category: "building", cost: 4, currency: "gold", footprint: [1, 1], color: "#b88a4a" },
  { id: "apartment_b",   name: "Apartment B",   category: "building", cost: 4, currency: "gold", footprint: [1, 1], color: "#a87a3a" },
  { id: "apartment_c",   name: "Apartment C",   category: "building", cost: 5, currency: "gold", footprint: [1, 1], color: "#9a6a2a" },

  // ---- Sketch-desert extras ----
  { id: "desert_walls_corner",name: "Desert Wall",      category: "building", cost: 1, currency: "gold", footprint: [1, 1], color: "#aa8030" },

  // ---- Tower defense extras ----
  { id: "tower_square_short", name: "Short Square Tower", category: "building", cost: 6, currency: "gold", footprint: [1, 1], color: "#a05bd8" },
  { id: "tower_round_short",  name: "Short Round Tower",  category: "building", cost: 6, currency: "gold", footprint: [1, 1], color: "#d8665b" },
  { id: "td_catapult",        name: "Catapult",           category: "building", cost: 8, currency: "gold", footprint: [1, 1], color: "#8a6a3a" },

  // ---- Fantasy town: market + props ----
  { id: "market_stall",  name: "Market Stall",     category: "building", cost: 3, currency: "gold", footprint: [1, 1], color: "#a86a4a" },
  { id: "stall_green",   name: "Green Stall",      category: "building", cost: 3, currency: "gold", footprint: [1, 1], color: "#3aa86a" },
  { id: "stall_red",     name: "Red Stall",        category: "building", cost: 3, currency: "gold", footprint: [1, 1], color: "#a83a3a" },
  { id: "fountain_round",   name: "Round Fountain",   category: "decoration", cost: 4, currency: "gold", footprint: [1, 1], color: "#88aacc" },
  { id: "fountain_square",  name: "Square Fountain",  category: "decoration", cost: 4, currency: "gold", footprint: [1, 1], color: "#88aacc" },
  { id: "cart",          name: "Cart",             category: "decoration", cost: 2, currency: "gold", footprint: [1, 1], color: "#a87040" },
  { id: "cart_high",     name: "Tall Cart",        category: "decoration", cost: 2, currency: "gold", footprint: [1, 1], color: "#a87040" },
  { id: "lantern",       name: "Lantern",          category: "decoration", cost: 1, currency: "gold", footprint: [1, 1], color: "#ffd060" },
  { id: "hedge",         name: "Hedge",            category: "decoration", cost: 1, currency: "gold", footprint: [1, 1], color: "#3a8a3a" },
  { id: "hedge_large",   name: "Tall Hedge",       category: "decoration", cost: 1, currency: "gold", footprint: [1, 1], color: "#2a7a2a" },
  { id: "banner_red",    name: "Red Banner",       category: "decoration", cost: 1, currency: "gold", footprint: [1, 1], color: "#c83838" },
  { id: "banner_green",  name: "Green Banner",     category: "decoration", cost: 1, currency: "gold", footprint: [1, 1], color: "#38c838" },
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
  { id: "tall_palm",       name: "Tall Palm",       category: "decoration", cost: 3, currency: "gold", footprint: [1, 1], color: "#5a9a3a" },
  { id: "round_pine",      name: "Round Pine",      category: "decoration", cost: 2, currency: "gold", footprint: [1, 1], color: "#2d6a3d" },
  { id: "small_pine",      name: "Small Pine",      category: "decoration", cost: 1, currency: "gold", footprint: [1, 1], color: "#2d6a3d" },
  { id: "tall_pine",       name: "Tall Pine",       category: "decoration", cost: 3, currency: "gold", footprint: [1, 1], color: "#1d5a2d" },
  { id: "plateau_tree",    name: "Plateau Tree",    category: "decoration", cost: 3, currency: "gold", footprint: [1, 1], color: "#4a8a3a" },
  { id: "small_tree",      name: "Small Tree",      category: "decoration", cost: 1, currency: "gold", footprint: [1, 1], color: "#5aa84a" },
  { id: "tall_tree",       name: "Tall Tree",       category: "decoration", cost: 3, currency: "gold", footprint: [1, 1], color: "#3a8a3a" },
  { id: "thin_tree",       name: "Thin Tree",       category: "decoration", cost: 2, currency: "gold", footprint: [1, 1], color: "#3a8a3a" },
  { id: "fall_oak",        name: "Autumn Oak",      category: "decoration", cost: 2, currency: "gold", footprint: [1, 1], color: "#d28a3a" },
  { id: "fall_maple",      name: "Autumn Maple",    category: "decoration", cost: 2, currency: "gold", footprint: [1, 1], color: "#c87a3a" },
  { id: "dark_oak",        name: "Dark Oak",        category: "decoration", cost: 2, currency: "gold", footprint: [1, 1], color: "#1a4a2a" },
  { id: "leafy_bush",      name: "Leafy Bush",      category: "decoration", cost: 0, currency: "gold", footprint: [1, 1], color: "#3a8a3a" },
  { id: "yellow_flowers",  name: "Yellow Flowers",  category: "decoration", cost: 0, currency: "gold", footprint: [1, 1], color: "#e8c838" },
  { id: "boulder",         name: "Boulder",         category: "decoration", cost: 1, currency: "gold", footprint: [1, 1], color: "#a8a8a8" },
  { id: "grass_tuft",      name: "Grass Tuft",      category: "decoration", cost: 0, currency: "gold", footprint: [1, 1], color: "#6aa852" },
];

export function getCatalogItem(id: string): CatalogItem | undefined {
  return CATALOG.find((item) => item.id === id);
}
