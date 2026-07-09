/**
 * Lane defense — headless simulation types.
 *
 * The whole game state is a small serializable object advanced by a pure,
 * deterministic function of wall-clock time. No RNG in v1: enemy pressure is
 * an aggregate DPS stream, not individual monsters (those are a rendering
 * concern for the UI layer later).
 */

export interface TowerSlot {
  /** Upgrade level. DPS grows multiplicatively with level. */
  level: number;
}

/** Progression that survives run resets. */
export interface DefenseMeta {
  /** Highest tier ever reached across all runs. Drives meta bonuses. */
  bestTier: number;
  /** Number of times the base has been destroyed (prestige count). */
  runsLost: number;
  /** Lifetime tier-ups across all runs. */
  totalTierUps: number;
  /** Lifetime gold invested across all runs. */
  totalGoldInvested: number;
}

export interface DefenseState {
  version: 3;
  /** Wall-clock ms of the last processed simulation tick. */
  lastTickMs: number;
  /** Wall-clock ms when the current run started. */
  runStartedMs: number;
  /** Current enemy tier (1-based). Advances when enough monsters are defeated. */
  tier: number;
  /**
   * Monsters defeated within the current tier (fractional between ticks).
   * Reaching params.killsPerTier summons the next, stronger generation.
   */
  kills: number;
  /** Base hit points, 0..params.hpMax. Reaching 0 resets the run. */
  baseHp: number;
  slots: TowerSlot[];
  /** Gold invested this run (display / reset bookkeeping). */
  goldInvestedRun: number;
  meta: DefenseMeta;
}

export interface DefenseParams {
  /** Fixed simulation tick in ms. Advance is quantized to this grid. */
  tickMs: number;
  /** Number of tower slots. */
  slotCount: number;
  /** DPS of a slot at level 1. */
  baseDpsPerSlot: number;
  /** Multiplicative DPS growth per slot level. */
  dpsGrowth: number;
  /** Gold cost of upgrading a slot from level 1 to 2. */
  upgradeCostBase: number;
  /** Multiplicative cost growth per slot level. */
  upgradeCostGrowth: number;
  /** Enemy DPS anchor: tier t deals enemyDpsBase * enemyDpsGrowth^t. */
  enemyDpsBase: number;
  /** Multiplicative enemy DPS growth per tier — the exponential ladder. */
  enemyDpsGrowth: number;
  /**
   * Relentless hourly enemy growth on top of the tier ladder, anchored at the
   * start of the current run (a collapse resets it). This is what makes the
   * horde "always pushing": banked advantage erodes overnight, so the morning
   * bleed returns no matter how well yesterday went.
   */
  enemyCreepPerHour: number;
  /** Base max HP. */
  hpMax: number;
  /**
   * Fraction of hpMax lost per hour per unit of relative power deficit.
   * Monsters are always at the walls: any deficit bleeds the base.
   */
  damageRatePerHour: number;
  /**
   * Deficit floor for the bleed: the horde always chips at least as if the
   * deficit were this large, even while you're at advantage. There is no
   * safe state — HP is the run's lifespan and only ever counts down.
   */
  chipBleedFloor: number;
  /** Monsters to defeat before the next, stronger generation arrives. */
  killsPerTier: number;
  /** Hours to clear a full tier when playerDps exactly matches enemyDps. */
  clearHoursAtParity: number;
  /** Kill-rate cap as a multiple of the parity rate, so overinvestment can't blow through many tiers at once. */
  killRateCap: number;
  /**
   * Super-linear reward for overpowering the stage: kill rate scales with
   * (playerDps/enemyDps)^exponent, so being far too strong for a tier rushes
   * you to the next one instead of waiting out a near-fixed clear time.
   */
  killRateExponent: number;
  /**
   * Kill-rate multiplier while below meta.bestTier ("you know these enemies"):
   * reclaiming lost ground is fast in either death mode, but scaling beyond
   * your best tier is always at the normal pace.
   */
  reclaimKillBoost: number;
  /**
   * What happens when the base falls.
   * "knockback": pushed back collapseTierSetback tiers, towers lose
   * collapseLevelLoss levels (floored at the meta starting level).
   * "reset": full prestige wipe back to tier 1 at the meta starting level.
   * Both reset the creep clock; both re-climb fast via reclaimKillBoost.
   */
  deathMode: "knockback" | "reset";
  /** Knockback mode: tiers lost on collapse (min tier 1). */
  collapseTierSetback: number;
  /** Knockback mode: tower levels lost on collapse (floored at the meta starting level). */
  collapseLevelLoss: number;
  /** Slot level at the start of a first run (no meta). */
  startLevel: number;
  /** Extra starting slot levels per bestTier — the "climb back faster" meta bonus. */
  metaStartLevelPerBestTier: number;
  /** Upgrade cost discount per bestTier (multiplicative: 1/(1 + d*bestTier)). */
  metaCostDiscountPerBestTier: number;
  /** Floor for the meta cost multiplier (max discount). */
  metaCostMultiplierFloor: number;
}

export type DefenseEvent =
  | { type: "tierUp"; atMs: number; tier: number }
  | { type: "underAttack"; atMs: number; tier: number }
  | {
      type: "baseDestroyed";
      atMs: number;
      tierReached: number;
      runMs: number;
      goldInvestedRun: number;
    };

export interface AdvanceResult {
  state: DefenseState;
  events: DefenseEvent[];
}
