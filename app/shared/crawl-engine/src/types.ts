/**
 * The Crawl — headless dungeon-crawler types.
 *
 * A run is a persistent object, not a session: it survives closing the app and
 * spans days. The overlay is glanced at for seconds at a time, so nothing may
 * depend on the player staying present — but time itself is no longer free. The
 * enemy swings on a wall clock (see `lastSwingMs`), softly capped so an absence
 * costs health rather than the run.
 *
 * Three scarce resources, all minted by real work and none by playing:
 *  - ENERGY pays for cards, and equals the gold you earned *today* (it expires
 *    at midnight and never banks). This is a mirror of the ledger, not a
 *    deduction: playing never lowers your real gold balance.
 *  - DRAW CREDITS refill an empty hand slot the moment a card leaves it, and come
 *    from micro-actions measured in tenths of gold. They also expire at midnight.
 *    Micro buys OPTIONS (a hand that keeps up with you); finished work buys POWER
 *    (the energy to play what is in it). Without a credit the slot simply waits
 *    for the enemy's next swing, which refills the hand for free.
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
  /** Single glyph used as the card's art in the narrow panel. */
  glyph: string;
  /** One short line shown under the name. */
  text: string;
}

export interface EnemyState {
  name: string;
  glyph: string;
  hp: number;
  maxHp: number;
  /**
   * Damage per swing, before `weakened`. Every swing is this size — there is no
   * telegraphed heavy any more. A heavy needed a countdown on screen to be fair,
   * and the panel no longer has a row to spend on one; a single honest number
   * next to the enemy's HP says everything the countdown used to.
   */
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
  /** An enemy is alive. The swing clock runs only in this state. */
  | "fighting"
  /** Enemy dead, the player owes a one-click card pick before moving on. */
  | "reward"
  /**
   * The last room of a floor is done and the next floor is waiting on one
   * click. This is the only place the run's depth is ever announced: the panel
   * dropped the permanent "floor 2 / room 1" strip, because a number that is
   * true all day is not worth the line it sits on, and the moment it CHANGES is
   * the only moment it means anything.
   */
  | "floorCleared"
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
   * Wall-clock ms of the enemy's last resolved swing. Every ENEMY_SWING_INTERVAL_MS
   * past it owes one more, resolved lazily whenever the run is next read.
   *
   * This is the one place the engine is allowed to care about real time, and it
   * replaced `playedThisTurn` — a flag that made the enemy respond to the player
   * rather than to a clock. That was the right answer while there were turns:
   * ending a turn cost HP and drawing required ending one, so a player short on
   * energy would have been forced to bleed out doing nothing. With no turns
   * there is nothing to end, so the pressure can come from time instead, and the
   * soft cap (MAX_PENDING_SWINGS, then BLEED_DAMAGE) is what keeps a slow week
   * from killing a run outright.
   *
   * Only meaningful while `status` is "fighting". Every path back into a fight
   * stamps it fresh, so the clock is genuinely paused on the reward and
   * floor-cleared screens rather than quietly accruing behind them.
   */
  lastSwingMs: number;

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
   * Slot refills already bought today off micro-gold. Credits available =
   * floor(microTenthsToday / MICRO_TENTHS_PER_DRAW) - drawsUsed.
   *
   * Counted separately from `energyUsed` because the two buy different things:
   * spending energy is a move in the fight, spending a draw credit only decides
   * how soon you have a card to make that move with — the swing clock would have
   * handed it over eventually for nothing. Keeping them apart is what stops a
   * pile of micro-actions from substituting for finishing something.
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
  | { type: "playerHit"; amount: number }
  /** A bleed tick: the run was left alone past its swing budget. */
  | { type: "bled"; amount: number }
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
