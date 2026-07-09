import type { DefenseParams } from "./types.js";

/**
 * Default balance. Tuned against the pacing targets asserted in pacing.test.ts
 * for a "good day" income of ~25 gold:
 *  - the horde is always at the walls: any power deficit bleeds the base,
 *    with roughly a day of HP when unupgraded
 *  - doing your todos and upgrading flips you to advantage: bleeding stops,
 *    repair kicks in, and you kill through the tier quickly
 *  - each cleared tier summons a stronger generation that usually resumes the
 *    slight bleed — the daily dance
 *  - costs outgrow flat income → the eventual fall knocks you back several
 *    tiers and undoes some upgrades (never below the meta floor), and meta
 *    progression makes the climb back much faster
 */
export const DEFAULT_PARAMS: DefenseParams = {
  tickMs: 60_000,
  slotCount: 4,
  baseDpsPerSlot: 2.1,
  dpsGrowth: 1.25,
  upgradeCostBase: 8,
  upgradeCostGrowth: 1.09,
  enemyDpsBase: 10,
  enemyDpsGrowth: 1.07,
  enemyCreepPerHour: 0.003,
  hpMax: 100_000,
  damageRatePerHour: 0.7,
  chipBleedFloor: 0.006,
  killsPerTier: 100,
  clearHoursAtParity: 22,
  killRateCap: 6,
  killRateExponent: 2,
  reclaimKillBoost: 8,
  deathMode: "reset",
  collapseTierSetback: 6,
  collapseLevelLoss: 2,
  startLevel: 2,
  metaStartLevelPerBestTier: 0.3,
  metaCostDiscountPerBestTier: 0.05,
  metaCostMultiplierFloor: 0.4,
};
