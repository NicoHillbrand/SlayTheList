/**
 * Lane defense — display math shared by the /defense page and the read-only
 * friend view. Pure derivations from a DefenseState; no sim advancement.
 */
import {
  DEFAULT_PARAMS,
  currentEnemyDps,
  killsPerHour,
  playerDps,
  type DefenseState,
} from "@slaythelist/defense-engine";

const P = DEFAULT_PARAMS;

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function fmtHours(h: number): string {
  if (!Number.isFinite(h) || h <= 0) return "—";
  if (h < 1) return "<1h";
  if (h < 48) return `${Math.round(h)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

export function fmtDps(n: number): string {
  return n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(1);
}

export interface BattleMath {
  pd: number;
  ed: number;
  adv: number;
  killRate: number;
  hoursToTier: number;
  status: "advancing" | "attacked";
  statusLine: string;
  forecast: string;
}

export function battleMath(state: DefenseState): BattleMath {
  const pd = playerDps(state, P);
  const ed = currentEnemyDps(state, P);
  const adv = pd / ed - 1;
  const reclaiming = state.tier < state.meta.bestTier;
  const killRate = killsPerHour(pd, ed, P, reclaiming);
  const hoursToTier = Math.max(0, P.killsPerTier - state.kills) / killRate;

  if (adv >= 0) {
    return {
      pd,
      ed,
      adv,
      killRate,
      hoursToTier,
      status: "advancing",
      statusLine: reclaiming
        ? "Reclaiming lost ground — you know these enemies"
        : "Ahead of the horde — they still chip the walls, but slowly",
      forecast: `Next generation in ~${fmtHours(hoursToTier)} — and they keep growing on their own`,
    };
  }
  const bleedPerHour = P.hpMax * Math.min(1, -adv) * P.damageRatePerHour;
  const drainHours = state.baseHp / bleedPerHour;
  return {
    pd,
    ed,
    adv,
    killRate,
    hoursToTier,
    status: "attacked",
    statusLine: "The horde is at the walls — the base is bleeding",
    forecast: `Base falls in ~${fmtHours(drainHours)} at this rate — upgrade to turn the tide`,
  };
}

/** Lane geometry + population for the theater, derived from state + advantage. */
export function laneVisuals(state: DefenseState, adv: number) {
  // The fight happens at the walls — the battle line sits just past the towers
  // and only eases outward a little as your advantage grows.
  const hordePush = clamp((adv + 0.15) / 0.75, 0, 1);
  const frontPct = 19.5 + hordePush * 17;
  const reclaiming = state.tier < state.meta.bestTier;
  const monsterCount = Math.min(4 + state.tier, 14) + (reclaiming ? 4 : 0);
  return { frontPct, reclaiming, monsterCount };
}
