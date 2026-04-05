/** Item catalog — all building definitions live here, not in the backend. */

import type { BaseCurrencyType } from "@slaythelist/contracts";

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
    id: "campfire",
    name: "Campfire",
    category: "building",
    cost: 0,
    currency: "gold",
    footprint: [1, 1],
    color: "#e8671c",
  },
  {
    id: "tent",
    name: "Tent",
    category: "building",
    cost: 5,
    currency: "gold",
    footprint: [2, 2],
    color: "#8b6914",
  },
  {
    id: "fence",
    name: "Fence",
    category: "decoration",
    cost: 2,
    currency: "gold",
    footprint: [1, 1],
    color: "#a0522d",
  },
  {
    id: "bush",
    name: "Bush",
    category: "decoration",
    cost: 1,
    currency: "gold",
    footprint: [1, 1],
    color: "#228b22",
  },
  {
    id: "tree",
    name: "Tree",
    category: "decoration",
    cost: 3,
    currency: "gold",
    footprint: [1, 1],
    color: "#006400",
  },

  // Unlockable through progression
  {
    id: "cottage",
    name: "Cottage",
    category: "building",
    cost: 25,
    currency: "gold",
    footprint: [2, 2],
    color: "#cd853f",
    unlockRequirement: { stat: "totalTodosCompleted", value: 10 },
  },
  {
    id: "workshop",
    name: "Workshop",
    category: "building",
    cost: 50,
    currency: "gold",
    footprint: [3, 2],
    color: "#b8860b",
    unlockRequirement: { stat: "totalTodosCompleted", value: 50 },
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
    id: "observatory",
    name: "Observatory",
    category: "building",
    cost: 60,
    currency: "gold",
    footprint: [2, 3],
    color: "#4169e1",
    unlockRequirement: { stat: "totalPredictions", value: 1 },
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
];

export function getCatalogItem(id: string): CatalogItem | undefined {
  return CATALOG.find((item) => item.id === id);
}
