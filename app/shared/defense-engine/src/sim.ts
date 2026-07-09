import {
  advance,
  buyUpgrade,
  cheapestUpgrade,
  createDefenseState,
} from "./engine.js";
import type {
  DefenseEvent,
  DefenseMeta,
  DefenseParams,
  DefenseState,
} from "./types.js";

const DAY_MS = 86_400_000;

export interface SimOptions {
  params: DefenseParams;
  /** Gold income, accrued continuously and spent greedily on the cheapest upgrade. */
  goldPerDay: number;
  days: number;
  startMs?: number;
  meta?: DefenseMeta;
  /** Sim step for the income/spend loop (defaults to 15 min). */
  stepMs?: number;
}

export interface SimResult {
  state: DefenseState;
  events: DefenseEvent[];
  /** ms offsets (from start) of each tier-up. */
  tierUpTimesMs: number[];
  /** ms offsets (from start) of each base destruction. */
  deathTimesMs: number[];
  goldSpent: number;
  goldUnspent: number;
}

/**
 * Simulate a player with a steady gold income and a greedy spend policy
 * (buy the cheapest upgrade whenever affordable). This is the balancing
 * harness the pacing targets are asserted against.
 */
export function simulatePlayer(opts: SimOptions): SimResult {
  const { params, goldPerDay, days } = opts;
  const startMs = opts.startMs ?? 0;
  const stepMs = opts.stepMs ?? 15 * 60_000;
  const endMs = startMs + days * DAY_MS;

  let state = createDefenseState(startMs, params, opts.meta);
  const events: DefenseEvent[] = [];
  let wallet = 0;
  let goldSpent = 0;

  for (let now = startMs + stepMs; now <= endMs; now += stepMs) {
    const res = advance(state, now, params);
    state = res.state;
    events.push(...res.events);

    wallet += (goldPerDay * stepMs) / DAY_MS;
    for (;;) {
      const { slotIndex, cost } = cheapestUpgrade(state, params);
      if (cost > wallet) break;
      const bought = buyUpgrade(state, slotIndex, params);
      state = bought.state;
      wallet -= bought.cost;
      goldSpent += bought.cost;
    }
  }

  return {
    state,
    events,
    tierUpTimesMs: events
      .filter((e) => e.type === "tierUp")
      .map((e) => e.atMs - startMs),
    deathTimesMs: events
      .filter((e) => e.type === "baseDestroyed")
      .map((e) => e.atMs - startMs),
    goldSpent,
    goldUnspent: wallet,
  };
}
