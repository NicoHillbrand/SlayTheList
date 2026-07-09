import type { CardId } from "@slaythelist/combat-engine";
import type { Faction } from "./cards";
import type { SigilKind } from "./icons";

/**
 * An expedition — one node on the map, and one RUN when entered: a sequence
 * of `stages` fights with the in-run shop/XP economy, ending against this
 * expedition's keeper. Difficulty ramps along the trail AND within each run.
 */
export interface Expedition {
  id: string;
  name: string;
  title: string;
  flavor: string;
  sigil: SigilKind;
  faction: Faction;
  /** Fights in this run, including the keeper finale. */
  stages: number;
  /** Trail position (0-based) — feeds opponent budget scaling. */
  difficulty: number;
  /** The keeper's lineup — the final stage of the run. */
  keeperDeck: CardId[];
  /** Emeralds (cosmetic currency) awarded on first clear.
   *  Never gold — gold flows one way, from finished todos into the game. */
  reward: number;
  boss?: boolean;
}

/** The trail — increasing difficulty and length, ending on the boss. Each
 *  node unlocks when the previous one is cleared. */
export const EXPEDITIONS: Expedition[] = [
  {
    id: "dummy",
    name: "Straw Dummy",
    title: "Training Grounds",
    flavor: "It does not hit back. Much.",
    sigil: "shield",
    faction: "stone",
    stages: 3,
    difficulty: 0,
    keeperDeck: ["pebble", "sprout", "cub"],
    reward: 1,
  },
  {
    id: "bandit",
    name: "Bramble Bandit",
    title: "The Overgrown Road",
    flavor: "Robs travellers with a hedge and a grin.",
    sigil: "leaf",
    faction: "forest",
    stages: 4,
    difficulty: 1,
    keeperDeck: ["sprout", "cub", "oaksentinel", "minnow"],
    reward: 1,
  },
  {
    id: "houndmaster",
    name: "The Houndmaster",
    title: "Kennels of Ash",
    flavor: "Whistles once. That is your only warning.",
    sigil: "fang",
    faction: "beast",
    stages: 5,
    difficulty: 2,
    keeperDeck: ["cub", "direwolf", "direwolf", "galehawk"],
    reward: 1,
  },
  {
    id: "warden",
    name: "Stone Warden",
    title: "The Sunken Gate",
    flavor: "Has stood the watch for nine hundred years.",
    sigil: "shield",
    faction: "stone",
    stages: 6,
    difficulty: 3,
    keeperDeck: ["runestone", "golem", "pebble", "runestone", "thornbeast"],
    reward: 2,
  },
  {
    id: "tempest",
    name: "Sky Tempest",
    title: "The Screaming Peaks",
    flavor: "Rides the storm it started.",
    sigil: "moon",
    faction: "sky",
    stages: 7,
    difficulty: 4,
    keeperDeck: ["galehawk@2", "stormroc", "finch", "galehawk", "embermage", "stormroc"],
    reward: 2,
  },
  {
    id: "witch",
    name: "The Tide Witch",
    title: "Drowned Cathedral",
    flavor: "Trades in tides and secrets.",
    sigil: "drop",
    faction: "tide",
    stages: 8,
    difficulty: 5,
    keeperDeck: ["tidecaller@2", "leviathan", "minnow@2", "voidorb", "tidecaller"],
    reward: 3,
  },
  {
    id: "hollowking",
    name: "The Hollow King",
    title: "Throne of Nothing",
    flavor: "Rules a kingdom of what you gave up on.",
    sigil: "eye",
    faction: "arcane",
    stages: 10,
    difficulty: 6,
    keeperDeck: ["guardian@2", "treant", "seer", "voidorb@2", "leviathan", "stormroc"],
    reward: 4,
    boss: true,
  },
];

export function getExpedition(id: string): Expedition | undefined {
  return EXPEDITIONS.find((e) => e.id === id);
}
