import type {
  AdvanceResult,
  DefenseEvent,
  DefenseMeta,
  DefenseParams,
  DefenseState,
} from "./types.js";

const HOUR_MS = 3_600_000;

export function emptyMeta(): DefenseMeta {
  return { bestTier: 0, runsLost: 0, totalTierUps: 0, totalGoldInvested: 0 };
}

function startingLevel(meta: DefenseMeta, params: DefenseParams): number {
  return (
    params.startLevel +
    Math.floor(meta.bestTier * params.metaStartLevelPerBestTier)
  );
}

/** Meta cost multiplier: cheaper upgrades the deeper you've ever pushed. */
export function metaCostMultiplier(
  meta: DefenseMeta,
  params: DefenseParams,
): number {
  return Math.max(
    params.metaCostMultiplierFloor,
    1 / (1 + params.metaCostDiscountPerBestTier * meta.bestTier),
  );
}

export function createDefenseState(
  nowMs: number,
  params: DefenseParams,
  meta: DefenseMeta = emptyMeta(),
): DefenseState {
  const level = startingLevel(meta, params);
  return {
    version: 3,
    lastTickMs: nowMs,
    runStartedMs: nowMs,
    tier: 1,
    kills: 0,
    baseHp: params.hpMax,
    slots: Array.from({ length: params.slotCount }, () => ({ level })),
    goldInvestedRun: 0,
    meta,
  };
}

export function slotDps(level: number, params: DefenseParams): number {
  return params.baseDpsPerSlot * Math.pow(params.dpsGrowth, level - 1);
}

export function playerDps(state: DefenseState, params: DefenseParams): number {
  let total = 0;
  for (const slot of state.slots) total += slotDps(slot.level, params);
  return total;
}

export function enemyDps(tier: number, params: DefenseParams): number {
  return params.enemyDpsBase * Math.pow(params.enemyDpsGrowth, tier);
}

/**
 * Enemy DPS including the relentless time creep since the run started.
 * `atMs` defaults to the state's own clock (last processed tick).
 */
export function currentEnemyDps(
  state: DefenseState,
  params: DefenseParams,
  atMs = state.lastTickMs,
): number {
  const hours = Math.max(0, atMs - state.runStartedMs) / HOUR_MS;
  return enemyDps(state.tier, params) * Math.pow(1 + params.enemyCreepPerHour, hours);
}

/**
 * Monsters defeated per hour at the given power ratio. At parity a full tier
 * (killsPerTier monsters) takes clearHoursAtParity. Overpowering the stage
 * pays super-linearly (ratio^killRateExponent, capped at killRateCap× parity)
 * so being too strong for a tier rushes you to the next one. While below the
 * best tier ever reached, the rate is further multiplied by reclaimKillBoost —
 * regaining lost ground is fast, scaling past your best never is.
 */
export function killsPerHour(
  pd: number,
  ed: number,
  params: DefenseParams,
  reclaiming = false,
): number {
  const ratio = Math.min(
    params.killRateCap,
    Math.pow(pd / ed, params.killRateExponent),
  );
  const boost = reclaiming ? params.reclaimKillBoost : 1;
  return (ratio * boost * params.killsPerTier) / params.clearHoursAtParity;
}

/** Gold cost to raise the given slot by one level (meta discount applied). */
export function upgradeCost(
  state: DefenseState,
  slotIndex: number,
  params: DefenseParams,
): number {
  const slot = state.slots[slotIndex];
  if (!slot) throw new Error(`no slot ${slotIndex}`);
  const raw =
    params.upgradeCostBase *
    Math.pow(params.upgradeCostGrowth, slot.level - 1) *
    metaCostMultiplier(state.meta, params);
  return Math.max(1, Math.round(raw));
}

/** Cheapest upgrade available right now (lowest-level slot). */
export function cheapestUpgrade(
  state: DefenseState,
  params: DefenseParams,
): { slotIndex: number; cost: number } {
  let slotIndex = 0;
  for (let i = 1; i < state.slots.length; i++) {
    if (state.slots[i].level < state.slots[slotIndex].level) slotIndex = i;
  }
  return { slotIndex, cost: upgradeCost(state, slotIndex, params) };
}

/**
 * Apply a purchased upgrade. The caller owns the wallet: check affordability
 * and deduct the returned cost from real gold before persisting.
 */
export function buyUpgrade(
  state: DefenseState,
  slotIndex: number,
  params: DefenseParams,
): { state: DefenseState; cost: number } {
  const cost = upgradeCost(state, slotIndex, params);
  const slots = state.slots.map((s, i) =>
    i === slotIndex ? { level: s.level + 1 } : s,
  );
  return {
    state: {
      ...state,
      slots,
      goldInvestedRun: state.goldInvestedRun + cost,
      meta: { ...state.meta, totalGoldInvested: state.meta.totalGoldInvested + cost },
    },
    cost,
  };
}

/**
 * Advance the simulation to `nowMs`. Pure and deterministic: chunked calls
 * produce bit-identical results to a single call because ticks are quantized
 * to a fixed grid anchored at lastTickMs.
 *
 * Each tick: your towers grind down the current tier's horde (kills accrue
 * super-linearly with the DPS ratio) while the horde is always at the walls —
 * it always chips at least chipBleedFloor, and a power deficit bleeds harder.
 * There is no regeneration: HP is the run's lifespan. Defeating killsPerTier
 * monsters summons the next, stronger generation: the daily dance.
 */
export function advance(
  state: DefenseState,
  nowMs: number,
  params: DefenseParams,
): AdvanceResult {
  const events: DefenseEvent[] = [];
  const ticks = Math.floor((nowMs - state.lastTickMs) / params.tickMs);
  if (ticks <= 0) return { state, events };

  const dtH = params.tickMs / HOUR_MS;
  const creep = 1 + params.enemyCreepPerHour;
  let { tier, kills, baseHp, goldInvestedRun, runStartedMs } = state;
  let slots = state.slots;
  let meta = state.meta;
  let tickMs = state.lastTickMs;
  let pd = playerDps(state, params);
  let edBase = enemyDps(tier, params);
  let wasBleeding = pd < currentEnemyDps(state, params);

  for (let i = 0; i < ticks; i++) {
    tickMs += params.tickMs;
    // Computed fresh from the tick offset (not accumulated) so chunked
    // advances stay bit-identical to one big advance.
    const ed = edBase * Math.pow(creep, (tickMs - runStartedMs) / HOUR_MS);

    kills += killsPerHour(pd, ed, params, tier < meta.bestTier) * dtH;

    {
      // No safe state: the horde always chips at least the floor amount;
      // a real power deficit bleeds proportionally harder.
      const deficit = Math.min(1, Math.max(params.chipBleedFloor, 1 - pd / ed));
      if (pd < ed && !wasBleeding) {
        events.push({ type: "underAttack", atMs: tickMs, tier });
        wasBleeding = true;
      } else if (pd >= ed) {
        wasBleeding = false;
      }
      baseHp -= params.hpMax * deficit * params.damageRatePerHour * dtH;
      if (baseHp <= 0) {
        meta = { ...meta, runsLost: meta.runsLost + 1 };
        events.push({
          type: "baseDestroyed",
          atMs: tickMs,
          tierReached: tier,
          runMs: tickMs - runStartedMs,
          goldInvestedRun,
        });
        // The battle is always on: either a knockback (pushed back tiers,
        // upgrades partly undone, floored at the meta level) or a full
        // prestige reset — both restart the creep clock.
        kills = 0;
        baseHp = params.hpMax;
        goldInvestedRun = 0;
        runStartedMs = tickMs;
        const floorLevel = startingLevel(meta, params);
        if (params.deathMode === "reset") {
          tier = 1;
          slots = Array.from({ length: params.slotCount }, () => ({ level: floorLevel }));
        } else {
          tier = Math.max(1, tier - params.collapseTierSetback);
          slots = slots.map((s) => ({
            level: Math.max(floorLevel, s.level - params.collapseLevelLoss),
          }));
        }
        pd = playerDps({ ...state, slots }, params);
        edBase = enemyDps(tier, params);
        wasBleeding = pd < edBase;
        continue;
      }
    }

    if (kills >= params.killsPerTier) {
      kills -= params.killsPerTier;
      tier += 1;
      edBase = enemyDps(tier, params);
      meta = {
        ...meta,
        totalTierUps: meta.totalTierUps + 1,
        bestTier: Math.max(meta.bestTier, tier),
      };
      events.push({ type: "tierUp", atMs: tickMs, tier });
    }
  }

  return {
    state: {
      ...state,
      lastTickMs: state.lastTickMs + ticks * params.tickMs,
      runStartedMs,
      tier,
      kills,
      baseHp,
      slots,
      goldInvestedRun,
      meta,
    },
    events,
  };
}
