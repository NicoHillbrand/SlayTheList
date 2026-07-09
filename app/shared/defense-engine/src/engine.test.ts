import { describe, expect, it } from "vitest";
import {
  advance,
  buyUpgrade,
  createDefenseState,
  emptyMeta,
  enemyDps,
  playerDps,
  upgradeCost,
} from "./engine.js";
import { DEFAULT_PARAMS } from "./params.js";

const P = DEFAULT_PARAMS;
const DAY = 86_400_000;

describe("engine mechanics", () => {
  it("does nothing for elapsed time shorter than one tick", () => {
    const s = createDefenseState(0, P);
    const { state, events } = advance(s, P.tickMs - 1, P);
    expect(state).toEqual(s);
    expect(events).toEqual([]);
  });

  it("is path-independent: one big advance equals uneven chunked advances", () => {
    let a = createDefenseState(0, P);
    a = buyUpgrade(a, 0, P).state;
    a = buyUpgrade(a, 1, P).state;

    const whole = advance(a, 3 * DAY, P).state;

    let chunked = a;
    // Deliberately un-round chunk boundaries.
    for (const t of [7_777_777, 0.5 * DAY, 1.1 * DAY, 1.100001 * DAY, 2.9 * DAY, 3 * DAY]) {
      chunked = advance(chunked, t, P).state;
    }
    expect(chunked).toEqual(whole);
  });

  it("is deterministic across repeated evaluation", () => {
    const s = createDefenseState(0, P);
    const r1 = advance(s, 5 * DAY, P);
    const r2 = advance(s, 5 * DAY, P);
    expect(r1).toEqual(r2);
  });

  it("upgrades raise DPS and cost grows with level", () => {
    const s = createDefenseState(0, P);
    const c0 = upgradeCost(s, 0, P);
    const bought = buyUpgrade(s, 0, P);
    expect(playerDps(bought.state, P)).toBeGreaterThan(playerDps(s, P));
    expect(bought.cost).toBe(c0);
    expect(upgradeCost(bought.state, 0, P)).toBeGreaterThan(c0);
  });

  it("defeating enough monsters summons the next tier", () => {
    let s = createDefenseState(0, P);
    for (let i = 0; i < 8; i++) s = buyUpgrade(s, i % P.slotCount, P).state;
    expect(playerDps(s, P)).toBeGreaterThan(enemyDps(s.tier, P));

    const { state, events } = advance(s, 1 * DAY, P);
    const tierUps = events.filter((e) => e.type === "tierUp");
    expect(tierUps.length).toBeGreaterThan(0);
    expect(state.tier).toBeGreaterThan(1);
    expect(state.meta.bestTier).toBe(state.tier);
  });

  it("bleeds while at deficit; damage sticks — no regeneration at advantage", () => {
    // Outmatched: fresh towers against tier 4.
    let weak = createDefenseState(0, P);
    weak = { ...weak, tier: 4 };
    const bled = advance(weak, 3 * 3_600_000, P).state;
    expect(bled.baseHp).toBeLessThan(P.hpMax);
    expect(bled.baseHp).toBeGreaterThan(0);

    // Now overpowered: the heavy bleed drops to the chip floor — still
    // ticking down slowly, and lost HP never comes back.
    let strong = { ...bled };
    for (let i = 0; i < 12; i++) strong = buyUpgrade(strong, i % P.slotCount, P).state;
    const later = advance(strong, strong.lastTickMs + 2 * 3_600_000, P).state;
    expect(later.baseHp).toBeLessThan(bled.baseHp);
    expect(later.baseHp).toBeGreaterThan(bled.baseHp - P.hpMax * 0.02);
  });

  it("overpowering a stage clears it super-linearly faster", () => {
    const even = createDefenseState(0, P);
    let strong = createDefenseState(0, P);
    for (let i = 0; i < 8; i++) strong = buyUpgrade(strong, i % P.slotCount, P).state;
    const dpsFactor = playerDps(strong, P) / playerDps(even, P);

    const evenKills = advance(even, 2 * 3_600_000, P).state.kills;
    const strongKills = advance(strong, 2 * 3_600_000, P).state.kills;
    // ratio^2 scaling: kills grow faster than the DPS factor alone.
    expect(strongKills).toBeGreaterThan(evenKills * dpsFactor * 1.2);
  });

  it("heavily outmatched: the base falls before the horde is cleared, then restarts with meta intact", () => {
    let s = createDefenseState(0, P);
    s = { ...s, tier: 8, meta: { ...s.meta, bestTier: 8 } };

    const { state, events } = advance(s, 1 * DAY, P);
    const death = events.find((e) => e.type === "baseDestroyed");
    expect(death).toBeDefined();
    expect(death && death.type === "baseDestroyed" ? death.tierReached : 0).toBe(8);
    expect(state.meta.runsLost).toBeGreaterThanOrEqual(1);
    expect(state.meta.bestTier).toBeGreaterThanOrEqual(8);
    expect(state.baseHp).toBeGreaterThan(0);
    // Meta grants extra starting levels on the rebuilt base.
    const fresh = createDefenseState(0, P);
    expect(state.slots[0].level).toBeGreaterThan(fresh.slots[0].level);
  });

  it("reset mode (default): collapse wipes back to tier 1 at the meta starting level", () => {
    let s = createDefenseState(0, P);
    s = { ...s, tier: 8, meta: { ...s.meta, bestTier: 8 } };

    const { state, events } = advance(s, 1 * DAY, P);
    expect(events.some((e) => e.type === "baseDestroyed")).toBe(true);
    expect(state.meta.runsLost).toBeGreaterThanOrEqual(1);
    // All slots equal at the meta floor right after the wipe (no partial levels kept).
    const levels = new Set(state.slots.map((x) => x.level));
    expect(levels.size).toBe(1);
    expect(state.baseHp).toBeGreaterThan(0);
  });

  it("knockback mode: collapse sets the tier back instead of wiping to 1", () => {
    const KB = { ...P, deathMode: "knockback" as const };
    let s = createDefenseState(0, KB);
    for (let i = 0; i < 12; i++) s = buyUpgrade(s, i % KB.slotCount, KB).state;
    s = { ...s, tier: 14, meta: { ...s.meta, bestTier: 14 } };

    const idle = advance(s, 1 * DAY, KB);
    const death = idle.events.find((e) => e.type === "baseDestroyed");
    expect(death).toBeDefined();
    // Replay to just past the collapse: knocked back, not at tier 1.
    const after = advance(s, death!.atMs + KB.tickMs, KB).state;
    expect(after.tier).toBe(Math.max(1, 14 - KB.collapseTierSetback));
  });

  it("reclaim boost: climbing below bestTier is much faster than fresh ground", () => {
    const fresh = createDefenseState(0, P);
    const veteran = createDefenseState(0, P, { ...emptyMeta(), bestTier: 10 });
    // Same slot levels so DPS is identical; only bestTier differs.
    const leveledVeteran = { ...veteran, slots: fresh.slots.map((x) => ({ ...x })) };

    // Compare progress via tier-ups (kills is a per-tier remainder).
    const freshUps = advance(fresh, 12 * 3_600_000, P).state.meta.totalTierUps;
    const veteranUps = advance(leveledVeteran, 12 * 3_600_000, P).state.meta.totalTierUps;
    expect(veteranUps).toBeGreaterThan(freshUps + 1);
  });

  it("meta discount makes upgrades cheaper", () => {
    const plain = createDefenseState(0, P);
    const seasoned = createDefenseState(0, P, {
      ...emptyMeta(),
      bestTier: 8,
    });
    // Compare at identical slot level.
    const leveled = {
      ...seasoned,
      slots: plain.slots.map((s) => ({ ...s })),
    };
    expect(upgradeCost(leveled, 0, P)).toBeLessThan(upgradeCost(plain, 0, P));
  });
});
