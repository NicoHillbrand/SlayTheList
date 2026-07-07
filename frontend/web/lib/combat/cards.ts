import { TRAINING_DUMMY, type Ability, type Card, type CardId } from "@slaythelist/combat-engine";
import type { SigilKind } from "./icons";

export type Rarity = "common" | "rare" | "epic" | "legendary";
export type Faction = "forest" | "beast" | "stone" | "sky" | "arcane" | "tide";

/** Card content lives here (not in the engine). Extends the engine `Card`
 *  with presentation-only fields: art sigil, faction colour, rarity, flavor. */
export interface GameCard extends Card {
  rarity: Rarity;
  faction: Faction;
  sigil: SigilKind;
  flavor: string;
  /** Star level (2/3) for merged units; absent = base card. */
  level?: 2 | 3;
}

// ---------------------------------------------------------------------------
// Unit levels — TFT-style merging. Leveled units are synthesized catalog
// entries ("cub@2") so the battle engine needs no changes at all.
// ---------------------------------------------------------------------------

/** Stat multiplier per level. 3 copies → ★2 (×2); two ★2 → ★3 (×4 — the
 *  merged copies' combined stats are conserved in one slot). */
export const LEVEL_MULT: Record<1 | 2 | 3, number> = { 1: 1, 2: 2, 3: 4 };

export function leveledId(baseId: CardId, level: 1 | 2 | 3): CardId {
  return level === 1 ? baseId : `${baseId}@${level}`;
}

export function baseCardId(id: CardId): CardId {
  const at = id.indexOf("@");
  return at === -1 ? id : id.slice(0, at);
}

export function unitLevel(id: CardId): 1 | 2 | 3 {
  const at = id.indexOf("@");
  if (at === -1) return 1;
  const lvl = Number(id.slice(at + 1));
  return lvl === 3 ? 3 : 2;
}

export const FACTION_COLOR: Record<Faction, string> = {
  forest: "#5fbf6a",
  beast: "#e0803a",
  stone: "#9aa4b2",
  sky: "#6fb7e8",
  arcane: "#b884e6",
  tide: "#4fd0c0",
};

/** Ranged factions fire projectiles in battle; the rest lunge into melee. */
export const RANGED_FACTIONS: ReadonlySet<Faction> = new Set(["sky", "arcane", "tide"]);

export const RARITY_COLOR: Record<Rarity, string> = {
  common: "#8a8f99",
  rare: "#5aa9e6",
  epic: "#b06fe6",
  legendary: "#f5c542",
};

export const RARITY_LABEL: Record<Rarity, string> = {
  common: "Common",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};

const TRIGGER_LABEL: Record<Ability["trigger"], string> = {
  battleStart: "Battle start",
  onFaint: "On death",
  onHurt: "When hurt",
};

const TARGET_LABEL: Record<Ability["target"], string> = {
  self: "self",
  allyBehind: "ally behind",
  allAllies: "all allies",
  frontEnemy: "front enemy",
  randomEnemy: "a random enemy",
  allEnemies: "all enemies",
};

/** Compact rules text, e.g. "Battle start: +4 ATK to ally behind". */
export function describeAbility(ability: Ability): string {
  const t = TRIGGER_LABEL[ability.trigger];
  const target = TARGET_LABEL[ability.target];
  switch (ability.effect) {
    case "buffAttack":
      return `${t}: +${ability.amount} ATK to ${target}`;
    case "buffHealth":
      return `${t}: +${ability.amount} HP to ${target}`;
    case "shield":
      return `${t}: shield ${ability.amount} on ${target}`;
    case "damage":
      return `${t}: deal ${ability.amount} to ${target}`;
    case "heal":
      return `${t}: heal ${ability.amount} on ${target}`;
    default:
      return "";
  }
}

export const CARD_LIST: GameCard[] = [
  // ---- Common ----
  {
    id: "sprout", name: "Sprout", faction: "forest", rarity: "common", sigil: "leaf",
    cost: 8, attack: 1, health: 28, attackSpeed: 0.9, flavor: "Everything great starts small.",
    ability: { trigger: "onFaint", effect: "buffHealth", target: "allyBehind", amount: 12 },
  },
  {
    id: "cub", name: "Wild Cub", faction: "beast", rarity: "common", sigil: "fang",
    cost: 9, attack: 2, health: 20, attackSpeed: 1.2, flavor: "Teeth still growing in.",
  },
  {
    id: "pebble", name: "Pebble Kin", faction: "stone", rarity: "common", sigil: "stone",
    cost: 8, attack: 1, health: 36, attackSpeed: 0.7, flavor: "Small, stubborn, unmoved.",
    ability: { trigger: "battleStart", effect: "shield", target: "self", amount: 18 },
  },
  {
    id: "finch", name: "Storm Finch", faction: "sky", rarity: "common", sigil: "feather",
    cost: 10, attack: 3, health: 12, attackSpeed: 1.6, flavor: "Strikes first, thinks never.",
  },
  {
    id: "wisp", name: "Mana Wisp", faction: "arcane", rarity: "common", sigil: "spark",
    cost: 9, attack: 1, health: 20, attackSpeed: 1.0, flavor: "A stray thought, made bright.",
    ability: { trigger: "battleStart", effect: "buffAttack", target: "allyBehind", amount: 2 },
  },
  {
    id: "minnow", name: "Reef Minnow", faction: "tide", rarity: "common", sigil: "drop",
    cost: 8, attack: 2, health: 28, attackSpeed: 1.1, flavor: "Never swims alone.",
    ability: { trigger: "onHurt", effect: "heal", target: "self", amount: 2 },
  },

  // ---- Rare ----
  {
    id: "direwolf", name: "Dire Wolf", faction: "beast", rarity: "rare", sigil: "fang",
    cost: 16, attack: 3, health: 36, attackSpeed: 1.3, flavor: "The pack remembers every debt.",
    ability: { trigger: "onFaint", effect: "buffAttack", target: "allyBehind", amount: 3 },
  },
  {
    id: "oaksentinel", name: "Oak Sentinel", faction: "forest", rarity: "rare", sigil: "leaf",
    cost: 18, attack: 2, health: 64, attackSpeed: 0.6, flavor: "Rooted, patient, unbreaking.",
    ability: { trigger: "battleStart", effect: "shield", target: "self", amount: 24 },
  },
  {
    id: "galehawk", name: "Gale Hawk", faction: "sky", rarity: "rare", sigil: "feather",
    cost: 17, attack: 4, health: 20, attackSpeed: 1.5, flavor: "Down from the sun, all talon.",
    ability: { trigger: "battleStart", effect: "buffAttack", target: "self", amount: 2 },
  },
  {
    id: "tidecaller", name: "Tide Caller", faction: "tide", rarity: "rare", sigil: "drop",
    cost: 17, attack: 3, health: 44, attackSpeed: 0.9, flavor: "The sea answers when she asks.",
    ability: { trigger: "onHurt", effect: "heal", target: "self", amount: 4 },
  },
  {
    id: "runestone", name: "Runestone", faction: "stone", rarity: "rare", sigil: "shield",
    cost: 18, attack: 2, health: 52, attackSpeed: 0.6, flavor: "Carved with a word for 'endure.'",
    ability: { trigger: "battleStart", effect: "shield", target: "allAllies", amount: 12 },
  },
  {
    id: "embermage", name: "Ember Adept", faction: "arcane", rarity: "rare", sigil: "flame",
    cost: 17, attack: 3, health: 28, attackSpeed: 1.0, flavor: "Warmth is just violence, tamed.",
    ability: { trigger: "battleStart", effect: "damage", target: "frontEnemy", amount: 15 },
  },

  // ---- Epic ----
  {
    id: "golem", name: "Stone Golem", faction: "stone", rarity: "epic", sigil: "shield",
    cost: 27, attack: 3, health: 80, attackSpeed: 0.5, flavor: "It was here before the mountain.",
    ability: { trigger: "onHurt", effect: "buffAttack", target: "self", amount: 1 },
  },
  {
    id: "thornbeast", name: "Thornbeast", faction: "forest", rarity: "epic", sigil: "leaf",
    cost: 28, attack: 4, health: 64, attackSpeed: 0.8, flavor: "The forest grew it a grudge.",
    ability: { trigger: "onHurt", effect: "damage", target: "frontEnemy", amount: 8 },
  },
  {
    id: "stormroc", name: "Storm Roc", faction: "sky", rarity: "epic", sigil: "moon",
    cost: 29, attack: 5, health: 44, attackSpeed: 1.1, flavor: "Its shadow is its own weather.",
    ability: { trigger: "battleStart", effect: "damage", target: "allEnemies", amount: 5 },
  },
  {
    id: "voidorb", name: "Void Orb", faction: "arcane", rarity: "epic", sigil: "arcane",
    cost: 28, attack: 4, health: 52, attackSpeed: 0.9, flavor: "Do not look directly into it.",
    ability: { trigger: "onFaint", effect: "damage", target: "allEnemies", amount: 15 },
  },

  // ---- Legendary ----
  {
    id: "treant", name: "Ancient Treant", faction: "forest", rarity: "legendary", sigil: "leaf",
    cost: 42, attack: 5, health: 96, attackSpeed: 0.55, flavor: "Counts its age in fallen kingdoms.",
    ability: { trigger: "battleStart", effect: "buffHealth", target: "allAllies", amount: 15 },
  },
  {
    id: "leviathan", name: "The Leviathan", faction: "tide", rarity: "legendary", sigil: "drop",
    cost: 48, attack: 8, health: 80, attackSpeed: 0.75, flavor: "The deep, given a will.",
    ability: { trigger: "battleStart", effect: "damage", target: "frontEnemy", amount: 20 },
  },
  {
    id: "seer", name: "Astral Seer", faction: "arcane", rarity: "legendary", sigil: "eye",
    cost: 44, attack: 5, health: 80, attackSpeed: 1.0, flavor: "Already knows how this ends.",
    ability: { trigger: "battleStart", effect: "buffAttack", target: "allAllies", amount: 2 },
  },
  {
    id: "guardian", name: "Moonstone Guardian", faction: "stone", rarity: "legendary", sigil: "crystal",
    cost: 46, attack: 6, health: 88, attackSpeed: 0.6, flavor: "Forged where the sky fell.",
    ability: { trigger: "battleStart", effect: "shield", target: "allAllies", amount: 24 },
  },
];

// Ranged is derived from faction: sky/arcane/tide shoot from any position at
// random enemies; the rest are melee and only fight from the front slot.
for (const card of CARD_LIST) card.ranged = RANGED_FACTIONS.has(card.faction);

/** ★2/★3 variants of every card — scaled stats and ability amounts. */
const LEVELED_VARIANTS: GameCard[] = CARD_LIST.flatMap((c) =>
  ([2, 3] as const).map((level) => {
    const mult = LEVEL_MULT[level];
    return {
      ...c,
      id: leveledId(c.id, level),
      level,
      attack: c.attack * mult,
      health: c.health * mult,
      ability: c.ability ? { ...c.ability, amount: c.ability.amount * mult } : undefined,
    };
  }),
);

/** The dummy is in the catalog (so battles can render it) but not CARD_LIST
 *  (so it never appears in shops or collections). */
const DUMMY_CARD: GameCard = {
  ...TRAINING_DUMMY,
  rarity: "common",
  faction: "stone",
  sigil: "shield",
  flavor: "It has seen worse.",
};

export const CARD_CATALOG: Record<CardId, GameCard> = {
  ...Object.fromEntries(CARD_LIST.map((c) => [c.id, c])),
  ...Object.fromEntries(LEVELED_VARIANTS.map((c) => [c.id, c])),
  [DUMMY_CARD.id]: DUMMY_CARD,
};

/** The deck every player starts with — cheap, gifted, no gold required. */
export const STARTER_DECK: CardId[] = ["sprout", "cub", "pebble", "finch"];

export function getCard(id: CardId): GameCard | undefined {
  return CARD_CATALOG[id];
}

/** Total attack+health of a deck — a rough "power" readout for the UI. */
export function deckPower(cardIds: CardId[]): number {
  return cardIds.reduce((sum, id) => {
    const c = CARD_CATALOG[id];
    return sum + (c ? c.attack + c.health : 0);
  }, 0);
}
