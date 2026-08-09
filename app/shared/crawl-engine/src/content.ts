/**
 * Crawl content — tuning constants, the card catalog, and the floor bestiary.
 *
 * Kept separate from `engine.ts` so balance is a data edit. Numbers are anchored
 * to the energy budget: energy is gold earned today, a good day is ~25 gold, and
 * a fight should cost roughly 6-9 energy. That puts a full 10-room run at
 * ~70 energy, i.e. several days of real work — a run is a week, not a sitting.
 */
import type { CrawlCard, CardId } from "./types.js";

/** Floors in a run. The last room of the last floor is the boss. */
export const FLOORS = 5;
/** Rooms (fights) per floor. */
export const ROOMS_PER_FLOOR = 2;

export const START_HP = 40;
/** Cards held at once. Small: the panel is ~340px wide. */
export const HAND_SIZE = 4;
/**
 * Cards drawn after the enemy's swing. This refills the hand rather than
 * topping it up by one, and that has to stay true: drawing one per turn caps
 * sustained output at about one card per enemy swing, so a long fight becomes
 * unwinnable arithmetic no matter how much energy is banked. Refilling makes
 * ENERGY the only thing limiting damage per turn, which is the whole point —
 * how hard you hit should track how much real work you did.
 *
 * Cards you did not play still persist; this only tops the hand back up.
 */
export const DRAW_PER_TURN = HAND_SIZE;

/** Bonus damage on every attack while a todo was completed recently. */
export const MOMENTUM_DAMAGE = 3;
/** How recent "recently" is, for momentum. */
export const MOMENTUM_WINDOW_MS = 60 * 60 * 1000;

/** Enemy turns between telegraphed heavy attacks. */
export const HEAVY_EVERY = 3;
export const HEAVY_MULTIPLIER = 2;

/** Gold paid into the real ledger for clearing the boss. */
export const BOSS_GOLD_REWARD = 10;
/**
 * Player HP restored on entering a new room, as a fraction of max. A full reset
 * is deliberate. The two resources have to measure different things:
 *
 *  - ENERGY spans the run and measures your work. Scarce on purpose.
 *  - HP spans a single fight and measures whether you played that fight well.
 *
 * If HP also ratcheted down across the run, the run's fate would be set by a
 * fight you half-remember from Tuesday, and a stretch of irregular play would
 * quietly doom you. Dying stays very possible — the boss will kill a player who
 * never blocks — but it is always a fight you just lost, not slow attrition.
 */
export const ROOM_ENTRY_HEAL_FRACTION = 1;

/** Cards offered after each win. */
export const REWARD_CHOICES = 3;

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export const CARDS: readonly CrawlCard[] = [
  // --- starters (never offered as rewards) ---
  {
    id: "strike",
    name: "Strike",
    cost: 1,
    effect: { damage: 6 },
    rarity: "starter",
    glyph: "🗡",
    text: "Deal 6 damage.",
  },
  {
    id: "guard",
    name: "Guard",
    cost: 1,
    effect: { block: 5 },
    rarity: "starter",
    glyph: "🛡",
    text: "Gain 5 block.",
  },
  {
    id: "lunge",
    name: "Lunge",
    cost: 2,
    effect: { damage: 14 },
    rarity: "starter",
    glyph: "⚔",
    text: "Deal 14 damage.",
  },

  // --- reward pool ---
  {
    id: "ward",
    name: "Ward",
    cost: 0,
    effect: { block: 4 },
    rarity: "common",
    glyph: "✦",
    text: "Free. Gain 4 block.",
  },
  {
    id: "scout",
    name: "Scout",
    cost: 0,
    effect: { draw: 2 },
    rarity: "common",
    glyph: "👁",
    text: "Free. Draw 2.",
  },
  {
    id: "rally",
    name: "Rally",
    cost: 1,
    effect: { damage: 4, draw: 1 },
    rarity: "common",
    glyph: "🔔",
    text: "Deal 4 damage. Draw 1.",
  },
  {
    id: "siphon",
    name: "Siphon",
    cost: 1,
    effect: { damage: 5, heal: 4 },
    rarity: "common",
    glyph: "🩸",
    text: "Deal 5 damage. Heal 4.",
  },
  {
    id: "whetstone",
    name: "Whetstone",
    cost: 1,
    effect: { strength: 3 },
    rarity: "common",
    glyph: "🪨",
    text: "+3 damage for the rest of the fight.",
  },
  {
    id: "cleave",
    name: "Cleave",
    cost: 2,
    effect: { damage: 11, block: 3 },
    rarity: "common",
    glyph: "🪓",
    text: "Deal 11 damage. Gain 3 block.",
  },
  {
    id: "hex",
    name: "Hex",
    cost: 2,
    effect: { damage: 9, weaken: 3 },
    rarity: "rare",
    glyph: "🕯",
    text: "Deal 9 damage. Enemy hits 3 softer.",
  },
  {
    id: "bulwark",
    name: "Bulwark",
    cost: 2,
    effect: { block: 12 },
    rarity: "rare",
    glyph: "🏰",
    text: "Gain 12 block.",
  },
  {
    id: "ember",
    name: "Ember",
    cost: 3,
    effect: { damage: 22 },
    rarity: "rare",
    glyph: "🔥",
    text: "Deal 22 damage.",
  },
] as const;

const CARD_BY_ID = new Map(CARDS.map((card) => [card.id, card]));

export function getCard(id: CardId): CrawlCard | undefined {
  return CARD_BY_ID.get(id);
}

/** Cards that can appear as a post-fight reward. */
export const REWARD_POOL: readonly CardId[] = CARDS.filter((c) => c.rarity !== "starter").map(
  (c) => c.id,
);

/** The deck every run opens with: 8 cards, no choices to make. */
export const STARTING_DECK: readonly CardId[] = [
  "strike",
  "strike",
  "strike",
  "strike",
  "guard",
  "guard",
  "guard",
  "lunge",
];

// ---------------------------------------------------------------------------
// Bestiary — two normal rooms per floor, the last floor ends in a boss.
// ---------------------------------------------------------------------------

interface EnemyTemplate {
  name: string;
  glyph: string;
  hp: number;
  attack: number;
}

/**
 * [room 0, room 1] per floor, 1-indexed by floor.
 *
 * HP climbs steeply and ATTACK climbs gently, on purpose. HP is what a fight
 * costs in energy, and energy is real work, so deeper floors should cost more
 * days. Attack is what a fight costs in risk, and it is capped against the
 * player's 40 HP pool: even the boss's telegraphed heavy (2x11) leaves room to
 * survive a mistake. Let attack scale with HP and the late floors stop being
 * hard and become arithmetically unwinnable — no achievable amount of block
 * keeps up.
 */
const BESTIARY: readonly (readonly [EnemyTemplate, EnemyTemplate])[] = [
  [
    { name: "Cellar Rat", glyph: "🐀", hp: 18, attack: 4 },
    { name: "Rot Crawler", glyph: "🪱", hp: 24, attack: 5 },
  ],
  [
    { name: "Bone Picker", glyph: "💀", hp: 32, attack: 5 },
    { name: "Cave Lurker", glyph: "🦇", hp: 38, attack: 6 },
  ],
  [
    { name: "Iron Husk", glyph: "🗿", hp: 48, attack: 6 },
    { name: "Gloom Weaver", glyph: "🕷", hp: 52, attack: 7 },
  ],
  [
    { name: "Ash Revenant", glyph: "👻", hp: 64, attack: 7 },
    { name: "Sump Warden", glyph: "🐊", hp: 72, attack: 8 },
  ],
  [
    { name: "Gate Sentinel", glyph: "⛩", hp: 84, attack: 9 },
    { name: "The Hollow King", glyph: "👑", hp: 120, attack: 11 },
  ],
];

export function isBossRoom(floor: number, room: number): boolean {
  return floor >= FLOORS && room >= ROOMS_PER_FLOOR - 1;
}

export function enemyTemplate(floor: number, room: number): EnemyTemplate {
  const floorRow = BESTIARY[Math.min(floor, FLOORS) - 1] ?? BESTIARY[0];
  return floorRow[Math.min(room, ROOMS_PER_FLOOR - 1)] ?? floorRow[0];
}

/** Total rooms in a full run — used for progress display. */
export const TOTAL_ROOMS = FLOORS * ROOMS_PER_FLOOR;
