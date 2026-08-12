/**
 * The Crawl — headless dungeon-crawler types.
 *
 * A run is a persistent object, not a session: it survives closing the app,
 * spans days, and can be left mid-fight without losing anything. That is the
 * whole point — the overlay is glanced at for seconds at a time, so no state
 * may depend on the player staying present.
 *
 * Three scarce resources, all minted by real work and none by playing:
 *  - ENERGY pays for cards, and equals the gold you earned *today* (it expires
 *    at midnight and never banks). This is a mirror of the ledger, not a
 *    deduction: playing never lowers your real gold balance.
 *  - DRAW CREDITS pay for extra cards, and come from micro-actions measured in
 *    tenths of gold. They also expire at midnight. Micro buys OPTIONS (a wider
 *    hand); finished work buys POWER (the energy to play what's in it).
 *  - WARDS are specific todos the agent pins to the run. While a pinned todo is
 *    unfinished the ENEMY is warded — it carries a shield that comes back every
 *    turn — so the fight is expensive rather than impossible. Finishing the todo
 *    shatters it. Nothing is ever frozen: see `EnemyState.ward`.
 *
 * Everything here is a pure function of (state, context). No wall-clock
 * simulation and no `Math.random()` — see `rng.ts`.
 */

export type CardId = string;

/**
 * What a card does when played. Every field is optional and additive, so one
 * code path in `applyCard` covers the whole catalog and new cards are content,
 * not engine changes.
 */
export interface CardEffect {
  /** Damage dealt to the enemy, before strength and momentum. */
  damage?: number;
  /** Block added to the player for the coming enemy turn. */
  block?: number;
  /** Player HP restored, capped at maxHp. */
  heal?: number;
  /** Permanent (this fight) bonus damage added to every later attack. */
  strength?: number;
  /** Cards drawn immediately, up to the hand cap. */
  draw?: number;
  /** Reduces the enemy's attack for the rest of the fight, floored at 1. */
  weaken?: number;
}

export type CardRarity = "starter" | "common" | "rare";

export interface CrawlCard {
  id: CardId;
  name: string;
  /** Energy cost. Energy is real gold earned today, so costs stay tiny. */
  cost: number;
  effect: CardEffect;
  rarity: CardRarity;
  /** Single glyph used as the card's art in the 340px panel. */
  glyph: string;
  /** One short line shown under the name. */
  text: string;
}

export interface EnemyState {
  name: string;
  glyph: string;
  hp: number;
  maxHp: number;
  /** Damage per normal attack, before `weakened`. */
  attack: number;
  /** Accumulated `weaken` from cards; subtracted from `attack`, floored at 1. */
  weakened: number;
  /**
   * Damage absorbed before HP, refilled to WARD_AMOUNT on every enemy turn for
   * as long as a pinned todo is unfinished.
   *
   * This is the whole soft-gate mechanism, and it replaced a hard freeze for one
   * reason: a frozen run means finishing the pinned todo merely *unblocks a
   * wall*, when the point is for it to *earn a turn*. Warded, you can always
   * play — your damage is just being eaten, so the pinned work is what makes
   * your cards land. Clearing it shatters the ward on the spot.
   */
  ward: number;
  /**
   * Turns until the telegraphed heavy attack (HEAVY_MULTIPLIER x attack).
   * Counts down on each enemy turn and resets to HEAVY_EVERY after it fires.
   * Telegraphing is what makes a turn worth thinking about for three seconds.
   */
  turnsUntilHeavy: number;
  boss: boolean;
}

/** Progression that survives death. */
export interface CrawlMeta {
  /** Deepest floor ever reached. */
  bestFloor: number;
  /** Full runs cleared (boss killed). */
  runsWon: number;
  /** Runs ended by death. */
  runsLost: number;
  /** Lifetime enemies killed. */
  kills: number;
}

export type CrawlStatus =
  /** An enemy is alive and it is the player's turn. */
  | "fighting"
  /** Enemy dead, the player owes a one-click card pick before moving on. */
  | "reward"
  /** Run over, the player died. Restarting is free. */
  | "dead"
  /** Boss cleared. */
  | "victory";

export interface CrawlState {
  version: 1;
  seed: number;
  /** Wall-clock ms the run started (display only, never simulated against). */
  runStartedMs: number;

  /** 1-based, up to FLOORS. */
  floor: number;
  /** 0-based room within the floor, up to ROOMS_PER_FLOOR - 1. */
  room: number;
  status: CrawlStatus;

  hp: number;
  maxHp: number;
  /** Block carried into the enemy's next attack; cleared when it resolves. */
  block: number;
  /** Strength gained this fight; reset when the next fight starts. */
  strength: number;

  /**
   * Whether a card has been played since the last enemy swing.
   *
   * The enemy only ever acts in RESPONSE to the player, never on a clock: with
   * no card played, `endTurn` does nothing at all. Without this the game has a
   * death spiral, because drawing requires ending a turn and ending a turn
   * costs HP — so a player short on energy would be forced to bleed out doing
   * nothing. Since energy is real work, that would mean a slow week kills the
   * run, which is the opposite of what this game is for.
   */
  playedThisTurn: boolean;

  /** Every card owned, including those in the piles. The run's identity. */
  deck: CardId[];
  hand: CardId[];
  drawPile: CardId[];
  discard: CardId[];

  enemy: EnemyState | null;
  /** The three cards offered after a win; null unless status is "reward". */
  rewardChoices: CardId[];

  /**
   * Local day (YYYY-MM-DD) that `energyUsed` and `drawsUsed` belong to. When the
   * server sees a different day it zeroes both — that is how today's energy and
   * draw credits expire.
   */
  energyDay: string;
  /** Energy already spent today. Available = goldEarnedToday - energyUsed. */
  energyUsed: number;
  /**
   * Extra cards already drawn today off micro-gold. Credits available =
   * floor(microTenthsToday / MICRO_TENTHS_PER_DRAW) - drawsUsed.
   *
   * Counted separately from `energyUsed` because the two buy different things:
   * spending energy is a move in the fight, spending a draw credit only widens
   * the hand you make that move from. Keeping them apart is what stops a pile of
   * micro-actions from substituting for finishing something.
   */
  drawsUsed: number;

  /**
   * A todo the agent pinned to the run. While it is set and not yet done, the
   * enemy is warded (see `EnemyState.ward`) — the fight costs more, but every
   * action stays available. Cleared once the player leaves the room, so a ward
   * covers the fight it was pinned during rather than the whole run.
   */
  wardTodoId: string | null;
  /** Denormalized for display, so the panel needs no second lookup. */
  wardTodoTitle: string | null;

  /** Monotone counter so every shuffle and reward roll draws fresh randomness. */
  rolls: number;

  meta: CrawlMeta;
}

/**
 * Everything the engine needs from the outside world. The caller (the API
 * store) owns all of it, which keeps the engine pure and testable.
 */
export interface CrawlContext {
  /** Gold earned today, from the ledger. The day's total energy budget. */
  goldEarnedToday: number;
  /**
   * Micro-action tenths earned today, from the micro counter. The day's total
   * draw-credit budget. Tenths that have already rolled over into whole gold
   * still count here — the rollover pays energy, it does not consume the tenths.
   */
  microTenthsToday: number;
  /** Local day key, so the engine can detect and apply the midnight reset. */
  today: string;
  /** True when a todo was completed recently — worth bonus damage. */
  momentum: boolean;
  /** True when no todo is pinned to the run, or the pinned one is done. */
  wardCleared: boolean;
  nowMs: number;
}

export type CrawlEvent =
  | { type: "cardPlayed"; cardId: CardId; damage: number }
  /** An extra card pulled off a micro-gold draw credit, not off a turn. */
  | { type: "cardDrawn"; cardId: CardId }
  | { type: "enemySlain"; name: string; boss: boolean }
  | { type: "playerHit"; amount: number; heavy: boolean }
  /** The pinned todo got done and the enemy's shield broke. */
  | { type: "wardShattered" }
  | { type: "floorCleared"; floor: number }
  | { type: "died"; floor: number }
  /** The boss fell. `goldReward` is paid by the caller, not the engine. */
  | { type: "runWon"; goldReward: number };

export interface CrawlResult {
  state: CrawlState;
  events: CrawlEvent[];
}
