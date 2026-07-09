import { describe, expect, it } from "vitest";
import { TRAINING_DUMMY, attackIntervalMs, resolveBattle, resolveDamageTest } from "./battle";
import type { BattleEvent, Card, CardId } from "./types";

const CATALOG: Record<CardId, Card> = {
  weak: { id: "weak", name: "Weakling", cost: 1, attack: 1, health: 1, attackSpeed: 1 },
  tank: { id: "tank", name: "Tank", cost: 5, attack: 2, health: 10, attackSpeed: 0.5 },
  glass: { id: "glass", name: "Glass Cannon", cost: 3, attack: 5, health: 1, attackSpeed: 1.5 },
  // Ability units
  shielder: {
    id: "shielder", name: "Shielder", cost: 4, attack: 1, health: 3, attackSpeed: 0.8,
    ability: { trigger: "battleStart", effect: "shield", target: "self", amount: 5 },
  },
  bomber: {
    id: "bomber", name: "Bomber", cost: 4, attack: 1, health: 1, attackSpeed: 1,
    ability: { trigger: "onFaint", effect: "damage", target: "allEnemies", amount: 3 },
  },
  thorns: {
    id: "thorns", name: "Thorns", cost: 4, attack: 1, health: 8, attackSpeed: 0.7,
    ability: { trigger: "onHurt", effect: "damage", target: "frontEnemy", amount: 2 },
  },
  kindler: {
    id: "kindler", name: "Kindler", cost: 4, attack: 1, health: 2, attackSpeed: 1,
    ability: { trigger: "battleStart", effect: "buffAttack", target: "allyBehind", amount: 4 },
  },
  healer: {
    id: "healer", name: "Healer", cost: 4, attack: 1, health: 6, attackSpeed: 0.8,
    ability: { trigger: "onHurt", effect: "heal", target: "self", amount: 2 },
  },
  archer: { id: "archer", name: "Archer", cost: 4, attack: 2, health: 3, attackSpeed: 1, ranged: true },
};

function eventsOf(type: BattleEvent["type"], events: BattleEvent[]): BattleEvent[] {
  return events.filter((e) => e.type === type);
}

describe("timeline basics", () => {
  it("is deterministic for identical inputs and seed", () => {
    const a = { cardIds: ["tank", "glass"] };
    const b = { cardIds: ["weak", "glass"] };
    expect(resolveBattle(a, b, CATALOG, 7)).toEqual(resolveBattle(a, b, CATALOG, 7));
  });

  it("lets the stronger deck win", () => {
    expect(resolveBattle({ cardIds: ["tank", "tank"] }, { cardIds: ["weak"] }, CATALOG).winner).toBe("a");
  });

  it("event timestamps are monotonically non-decreasing", () => {
    const { events } = resolveBattle({ cardIds: ["tank", "glass"] }, { cardIds: ["thorns", "healer"] }, CATALOG, 4);
    for (let i = 1; i < events.length; i += 1) {
      expect(events[i].t).toBeGreaterThanOrEqual(events[i - 1].t);
    }
  });

  it("faster units attack more often (measured vs the dummy over a fixed window)", () => {
    // Glass (1.5/s) and tank (0.5/s) hitting the dummy for 10s: glass should
    // land roughly 3x the attacks — nothing dies, so counts are pure cadence.
    const { result } = resolveDamageTest({ cardIds: ["glass", "tank"] }, CATALOG, 10_000, 6);
    const glassAttacks = result.events.filter(
      (e) => e.type === "attack" && e.attacker.unit === "Glass Cannon",
    ).length;
    const tankAttacks = result.events.filter((e) => e.type === "attack" && e.attacker.unit === "Tank").length;
    // 10s window: glass ~ every 933ms (≥9 swings), tank ~ every 2800ms (≤4).
    expect(glassAttacks).toBeGreaterThanOrEqual(9);
    expect(tankAttacks).toBeLessThanOrEqual(4);
    expect(glassAttacks).toBeGreaterThan(tankAttacks * 2);
  });

  it("attack cadence matches attackSpeed intervals (after a staggered opener)", () => {
    const { events } = resolveBattle({ cardIds: ["tank"] }, { cardIds: ["tank"] }, CATALOG, 8);
    const times = events.filter((e) => e.type === "attack" && e.side === "a").map((e) => e.t);
    const interval = attackIntervalMs(0.5);
    expect(times.length).toBeGreaterThan(1);
    // First swing lands somewhere in [50%, 100%] of the interval...
    expect(times[0]).toBeGreaterThanOrEqual(interval / 2);
    expect(times[0]).toBeLessThanOrEqual(interval);
    // ...then the cadence is exact.
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i] - times[i - 1]).toBe(interval);
    }
  });

  it("mirror matches are fair across many seeds", () => {
    let aWins = 0;
    let bWins = 0;
    for (let seed = 1; seed <= 200; seed += 1) {
      const { winner } = resolveBattle({ cardIds: ["tank"] }, { cardIds: ["tank"] }, CATALOG, seed);
      if (winner === "a") aWins += 1;
      else if (winner === "b") bWins += 1;
    }
    expect(Math.abs(aWins - bWins)).toBeLessThan(40);
  });

  it("skips unknown card ids instead of crashing", () => {
    const result = resolveBattle({ cardIds: ["tank", "ghost"] }, { cardIds: ["weak"] }, CATALOG);
    expect(result.winner).toBe("a");
  });

  it("returns final unit states aligned with the decks", () => {
    const result = resolveBattle({ cardIds: ["tank", "weak"] }, { cardIds: ["weak"] }, CATALOG, 3);
    expect(result.finalA).toHaveLength(2);
    expect(result.finalA[0].name).toBe("Tank");
    expect(result.finalB[0].alive).toBe(false);
  });
});

describe("abilities on the timeline", () => {
  it("battleStart shield fires at t=0 and soaks before health", () => {
    const result = resolveBattle({ cardIds: ["shielder"] }, { cardIds: ["weak"] }, CATALOG, 3);
    const shieldEvent = result.events.find((e) => e.type === "ability" && e.effect === "shield");
    expect(shieldEvent).toBeDefined();
    expect(shieldEvent!.t).toBe(0);
    const firstHit = result.events.find((e) => e.type === "attack" && e.side === "b");
    expect(firstHit?.type).toBe("attack");
    if (firstHit?.type === "attack") {
      expect(firstHit.absorbed).toBe(firstHit.damage);
      expect(firstHit.defenderHealth).toBe(3);
    }
  });

  it("onFaint bomb hits all enemies and can chain faints", () => {
    const result = resolveBattle({ cardIds: ["bomber"] }, { cardIds: ["tank", "weak"] }, CATALOG, 5);
    const faints = eventsOf("faint", result.events).filter((e) => e.type === "faint" && e.side === "b");
    expect(faints.some((f) => f.type === "faint" && f.unit === "Weakling")).toBe(true);
  });

  it("onHurt thorns punishes attackers", () => {
    const result = resolveBattle({ cardIds: ["thorns"] }, { cardIds: ["tank"] }, CATALOG, 11);
    const reflections = eventsOf("ability", result.events).filter(
      (e) => e.type === "ability" && e.trigger === "onHurt" && e.source.unit === "Thorns",
    );
    expect(reflections.length).toBeGreaterThan(0);
  });

  it("heal-outpacing stalemates hit the time cap and resolve by health tiebreak", () => {
    const result = resolveBattle({ cardIds: ["healer"] }, { cardIds: ["healer"] }, CATALOG, 9);
    expect(result.duration).toBeLessThanOrEqual(90_000);
    expect(["a", "b", "draw"]).toContain(result.winner);
    const endEvent = result.events[result.events.length - 1];
    expect(endEvent.type).toBe("end");
  });
});

describe("melee vs ranged positioning", () => {
  it("benched melee units do not attack while an ally holds the front", () => {
    const { result } = resolveDamageTest({ cardIds: ["tank", "weak"] }, CATALOG, 10_000, 4);
    const weakAttacks = result.events.filter((e) => e.type === "attack" && e.attacker.unit === "Weakling");
    expect(weakAttacks).toHaveLength(0); // tank never dies vs the dummy
  });

  it("ranged units attack from the bench", () => {
    const { result } = resolveDamageTest({ cardIds: ["tank", "archer"] }, CATALOG, 10_000, 4);
    const archerAttacks = result.events.filter((e) => e.type === "attack" && e.attacker.unit === "Archer");
    // 10s window at 1 atk/s with the 1.4x pace scale ≈ 6-7 swings.
    expect(archerAttacks.length).toBeGreaterThanOrEqual(6);
  });

  it("ranged units hit random targets, not only the front", () => {
    // Archer team vs a fat front tank + weak back unit: across seeds, some
    // arrows must land on the back unit while the tank still lives.
    let hitsOnBack = 0;
    for (let seed = 1; seed <= 20; seed += 1) {
      const { events } = resolveBattle(
        { cardIds: ["archer", "archer"] },
        { cardIds: ["tank", "healer"] },
        CATALOG,
        seed,
      );
      hitsOnBack += events.filter(
        (e) => e.type === "attack" && e.attacker.unit === "Archer" && e.defender.index === 1,
      ).length;
    }
    expect(hitsOnBack).toBeGreaterThan(0);
  });
});

describe("damage test (training dummy)", () => {
  it("measures deck damage against the unkillable dummy", () => {
    const test = resolveDamageTest({ cardIds: ["glass", "tank"] }, CATALOG, 10_000, 2);
    expect(test.damage).toBeGreaterThan(0);
    expect(test.dps).toBeCloseTo(test.damage / 10, 5);
    // The dummy never fights back, so the team survives.
    expect(test.result.finalA.every((u) => u.alive)).toBe(true);
  });

  it("dummy never attacks", () => {
    const test = resolveDamageTest({ cardIds: ["weak"] }, CATALOG, 5_000, 2);
    const dummyAttacks = test.result.events.filter(
      (e) => e.type === "attack" && e.attacker.unit === TRAINING_DUMMY.name,
    );
    expect(dummyAttacks).toHaveLength(0);
  });

  it("higher DPS decks score higher", () => {
    const slow = resolveDamageTest({ cardIds: ["tank"] }, CATALOG, 10_000, 2);
    const fast = resolveDamageTest({ cardIds: ["glass"] }, CATALOG, 10_000, 2);
    expect(fast.damage).toBeGreaterThan(slow.damage);
  });
});
