import { describe, expect, it } from "vitest";
import { advance } from "./engine.js";
import { DEFAULT_PARAMS } from "./params.js";
import { simulatePlayer } from "./sim.js";

const P = DEFAULT_PARAMS;
const DAY = 86_400_000;
const HOUR = 3_600_000;

/**
 * Design targets (2026-07-08 discussion, no-regen model):
 *  - the horde always chips the base while you're behind; damage STICKS (no
 *    regeneration) — HP is the run's lifespan, unattended it falls in ~a day
 *  - a "good day" of todos earns ~25 gold; investing it stops the bleed, and
 *    overpowering a stage clears it super-linearly faster
 *  - collapse = full reset, but the reclaim boost sprints you back to near
 *    your best tier within ~a day; scaling past it is normal-paced
 */
const GOLD_PER_DAY = 25;

describe("pacing targets", () => {
  it("prints a pacing table for inspection", () => {
    const sim = simulatePlayer({ params: P, goldPerDay: GOLD_PER_DAY, days: 30 });
    const gaps = sim.tierUpTimesMs.map((t, i) =>
      ((t - (sim.tierUpTimesMs[i - 1] ?? 0)) / DAY).toFixed(2),
    );
    // eslint-disable-next-line no-console
    console.log(
      `30d @ ${GOLD_PER_DAY}g/day → tier ${sim.state.tier}, collapses ${sim.deathTimesMs.length}, ` +
        `spent ${Math.round(sim.goldSpent)}g, bestTier ${sim.state.meta.bestTier}\n` +
        `tier-up days: ${sim.tierUpTimesMs.map((t) => (t / DAY).toFixed(1)).join(", ")}\n` +
        `gaps (days): ${gaps.join(", ")}\n` +
        `collapse days: ${sim.deathTimesMs.map((t) => (t / DAY).toFixed(1)).join(", ") || "none"}`,
    );
    expect(sim.tierUpTimesMs.length).toBeGreaterThan(0);
  });

  it("steady investment keeps the frontier climbing (collapses are part of the loop)", () => {
    const sim = simulatePlayer({ params: P, goldPerDay: GOLD_PER_DAY, days: 14 });
    // No regen: runs are mortal even when played well, but resets are cheap
    // (fast reclaim), so the frontier — bestTier — keeps growing.
    expect(sim.state.meta.bestTier).toBeGreaterThanOrEqual(7);
    expect(sim.deathTimesMs.length).toBeLessThanOrEqual(8);

    const ups = sim.tierUpTimesMs;
    expect(ups.length).toBeGreaterThanOrEqual(6);
  });

  it("stopping investment loses the base within ~a day or two", () => {
    // Play normally for 10 days, then walk away.
    const sim = simulatePlayer({ params: P, goldPerDay: GOLD_PER_DAY, days: 10 });

    const idle = advance(sim.state, sim.state.lastTickMs + 6 * DAY, P);
    const death = idle.events.find((e) => e.type === "baseDestroyed");
    expect(death).toBeDefined();
    const hoursToDeath = (death!.atMs - sim.state.lastTickMs) / HOUR;
    // eslint-disable-next-line no-console
    console.log(`idle collapse after ${hoursToDeath.toFixed(1)}h`);
    expect(hoursToDeath).toBeGreaterThanOrEqual(6);
    expect(hoursToDeath).toBeLessThanOrEqual(60);
  });

  it("collapse wipes to tier 1 and the reclaim sprint is fast", () => {
    const sim = simulatePlayer({ params: P, goldPerDay: GOLD_PER_DAY, days: 10 });
    const bestBefore = sim.state.meta.bestTier;

    const idle = advance(sim.state, sim.state.lastTickMs + 6 * DAY, P);
    const death = idle.events.find((e) => e.type === "baseDestroyed");
    expect(death).toBeDefined();

    // Just past the collapse: a fresh run on the legacy floor.
    const after = advance(sim.state, death!.atMs + P.tickMs, P).state;
    expect(after.tier).toBe(1);
    expect(after.baseHp).toBeGreaterThan(P.hpMax * 0.9);

    // Within 24h of the collapse (no gold spent at all), the reclaim boost
    // alone carries the run back to within a few tiers of the old best.
    const reclaimed = advance(sim.state, death!.atMs + 24 * HOUR, P).state;
    // eslint-disable-next-line no-console
    console.log(`24h after wipe: tier ${reclaimed.tier} (best was ${bestBefore})`);
    expect(reclaimed.tier).toBeGreaterThanOrEqual(bestBefore - 4);
  });

  it("frontier pace slows as costs outgrow flat income", () => {
    // Runs are mortal, so measure the pace of NEW bestTier ground only —
    // reclaim sprints after collapses don't count.
    const sim = simulatePlayer({ params: P, goldPerDay: GOLD_PER_DAY, days: 30 });
    const frontier: number[] = [];
    let maxTier = 0;
    for (const e of sim.events) {
      if (e.type === "tierUp" && e.tier > maxTier) {
        maxTier = e.tier;
        frontier.push(e.atMs);
      }
    }
    expect(frontier.length).toBeGreaterThanOrEqual(8);
    const early = frontier[3] - frontier[1];
    const late = frontier[frontier.length - 1] - frontier[frontier.length - 3];
    expect(late).toBeGreaterThan(early);
  });

  it("meta progression makes regaining the best tier much faster", () => {
    const first = simulatePlayer({ params: P, goldPerDay: GOLD_PER_DAY, days: 21 });
    const bestTier = first.state.meta.bestTier;
    expect(bestTier).toBeGreaterThanOrEqual(5);
    const firstTimeToBest = first.tierUpTimesMs[bestTier - 2]; // tier-up i lands on tier i+2

    const second = simulatePlayer({
      params: P,
      goldPerDay: GOLD_PER_DAY,
      days: 21,
      meta: { ...first.state.meta },
    });
    // Find when the second run reaches bestTier again (tier-up i lands on tier i+2).
    let secondTimeToBest: number | undefined;
    let tier = 1;
    for (const t of second.tierUpTimesMs) {
      tier += 1;
      if (tier >= bestTier) {
        secondTimeToBest = t;
        break;
      }
    }
    expect(secondTimeToBest).toBeDefined();
    // eslint-disable-next-line no-console
    console.log(
      `first climb to tier ${bestTier}: ${(firstTimeToBest / DAY).toFixed(1)}d, ` +
        `with meta: ${(secondTimeToBest! / DAY).toFixed(1)}d`,
    );
    expect(secondTimeToBest!).toBeLessThan(firstTimeToBest * 0.5);
  });

  it("zero-input fresh install survives the honeymoon then falls (gentle onboarding)", () => {
    const sim = simulatePlayer({ params: P, goldPerDay: 0, days: 14 });
    expect(sim.deathTimesMs.length).toBeGreaterThanOrEqual(1);
    const firstDeathDays = sim.deathTimesMs[0] / DAY;
    // eslint-disable-next-line no-console
    console.log(`fresh zero-input collapse at day ${firstDeathDays.toFixed(1)}`);
    expect(firstDeathDays).toBeGreaterThanOrEqual(1);
    expect(firstDeathDays).toBeLessThanOrEqual(7);
  });
});
