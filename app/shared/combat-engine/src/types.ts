/**
 * Core combat types. The engine defines the *rules*; the card *content*
 * (stats, names, art) lives in the frontend so it can iterate without
 * touching — or rebuilding — this package.
 *
 * Ability design follows the Super Auto Pets composability pattern: a small
 * closed set of Triggers × Effects × Targets. Every card ability is one row
 * from each table, so new cards are combinations — not bespoke mechanics.
 */

export type CardId = string;

export type AbilityTrigger = "battleStart" | "onFaint" | "onHurt";

export type AbilityEffect = "buffAttack" | "buffHealth" | "shield" | "damage" | "heal";

export type AbilityTarget =
  | "self"
  | "allyBehind"
  | "allAllies"
  | "frontEnemy"
  | "randomEnemy"
  | "allEnemies";

export interface Ability {
  trigger: AbilityTrigger;
  effect: AbilityEffect;
  target: AbilityTarget;
  amount: number;
}

/** A single card definition. Content lives elsewhere; this is just the shape. */
export interface Card {
  id: CardId;
  name: string;
  /** Gold cost in the shop. */
  cost: number;
  attack: number;
  health: number;
  /** Attacks per second. 0 = never attacks (e.g. the training dummy). */
  attackSpeed: number;
  /** Ranged units attack from any position and hit a RANDOM enemy; melee
   *  units only attack while they hold the front slot, and hit the enemy
   *  front. This is what makes lineup order a real decision. */
  ranged?: boolean;
  ability?: Ability;
  tags?: string[];
}

/**
 * The shareable, read-only form of a deck — the exact analogue of the base
 * builder's `BaseSnapshot`. This is what gets stored and battled against for
 * async snapshot PvP (no live opponent needed).
 */
export interface DeckSnapshot {
  /** Optional display label, e.g. "@alice's deck". */
  ownerLabel?: string;
  /** Ordered lineup — index 0 is the front unit. */
  cardIds: CardId[];
}

/** A card resolved into a mutable in-battle unit. */
export interface UnitState {
  cardId: CardId;
  name: string;
  attack: number;
  attackSpeed: number;
  health: number;
  maxHealth: number;
  shield: number;
  alive: boolean;
}

export type Side = "a" | "b";

/** A unit reference inside an event — enough for a renderer to address it. */
export interface UnitRef {
  side: Side;
  index: number;
  unit: string;
}

/** Post-effect stat snapshot so renderers can apply events without re-simulating. */
export interface TargetOutcome extends UnitRef {
  health: number;
  shield: number;
  attack: number;
}

/** All events carry `t` — sim time in ms — so a renderer plays them on a clock. */
export type BattleEvent =
  | { t: number; type: "start"; a: string[]; b: string[] }
  | {
      t: number;
      type: "ability";
      trigger: AbilityTrigger;
      effect: AbilityEffect;
      amount: number;
      source: UnitRef;
      targets: TargetOutcome[];
    }
  | {
      t: number;
      type: "attack";
      side: Side;
      attacker: UnitRef;
      defender: UnitRef;
      damage: number;
      /** Portion of the hit soaked by the defender's shield. */
      absorbed: number;
      crit: boolean;
      defenderHealth: number;
      defenderShield: number;
    }
  | { t: number; type: "faint"; side: Side; index: number; unit: string }
  | { t: number; type: "end"; winner: Side | "draw" };

export interface BattleResult {
  winner: Side | "draw";
  events: BattleEvent[];
  /** Sim duration in ms. */
  duration: number;
  /** Unit states when the battle ended — index-aligned with the decks. */
  finalA: UnitState[];
  finalB: UnitState[];
  /** Seed the battle ran with — replaying with it reproduces the result. */
  seed: number;
}
