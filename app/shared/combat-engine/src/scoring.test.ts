import { describe, expect, it } from "vitest";
import type { Prediction } from "@slaythelist/contracts";
import { betPayout, computeCalibration, scoreMultiplier } from "./scoring";

describe("scoreMultiplier", () => {
  it("rewards a confident correct call and punishes a confident wrong one", () => {
    expect(scoreMultiplier(0.9, 1)).toBeCloseTo(0.98, 5);
    expect(scoreMultiplier(0.9, 0)).toBeCloseTo(-0.62, 5);
  });

  it("is flat at 0.5 regardless of outcome (hedging is safe but unprofitable)", () => {
    expect(scoreMultiplier(0.5, 1)).toBeCloseTo(0.5, 5);
    expect(scoreMultiplier(0.5, 0)).toBeCloseTo(0.5, 5);
  });
});

describe("betPayout is a proper scoring rule", () => {
  it("expected payout is maximized by reporting your true probability", () => {
    // For each true probability q, the confidence f that maximizes expected
    // payout should be q itself — that is what makes overconfidence -EV.
    for (let qi = 5; qi <= 95; qi += 5) {
      const q = qi / 100;
      let bestF = -1;
      let bestE = -Infinity;
      for (let fi = 1; fi <= 99; fi += 1) {
        const f = fi / 100;
        const e = q * scoreMultiplier(f, 1) + (1 - q) * scoreMultiplier(f, 0);
        if (e > bestE) {
          bestE = e;
          bestF = f;
        }
      }
      expect(Math.abs(bestF - q)).toBeLessThanOrEqual(0.011);
    }
  });

  it("returns integer gold deltas", () => {
    expect(betPayout(100, 90, "hit")).toBe(98);
    expect(betPayout(100, 90, "miss")).toBe(-62);
    expect(betPayout(50, 50, "hit")).toBe(25);
  });
});

describe("computeCalibration", () => {
  it("reports a null Brier when nothing is resolved", () => {
    expect(computeCalibration([]).brier).toBeNull();
    expect(computeCalibration([mk("a", 70, "pending")]).resolved).toBe(0);
  });

  it("computes Brier over resolved predictions only", () => {
    const stats = computeCalibration([
      mk("a", 80, "hit"),
      mk("b", 80, "miss"),
      mk("c", 50, "pending"),
    ]);
    expect(stats.resolved).toBe(2);
    // ((0.8-1)^2 + (0.8-0)^2) / 2 = (0.04 + 0.64) / 2 = 0.34
    expect(stats.brier).toBeCloseTo(0.34, 5);
  });

  it("buckets predictions by nearest 10% for a reliability diagram", () => {
    const stats = computeCalibration([
      mk("a", 72, "hit"),
      mk("b", 68, "miss"),
      mk("c", 70, "hit"),
    ]);
    expect(stats.buckets).toHaveLength(1);
    const [bucket] = stats.buckets;
    expect(bucket.confidence).toBe(70);
    expect(bucket.count).toBe(3);
    expect(bucket.actual).toBeCloseTo((2 / 3) * 100, 5);
  });
});

function mk(id: string, confidence: number, outcome: "hit" | "miss" | "pending"): Prediction {
  return {
    id,
    title: `prediction ${id}`,
    confidence,
    outcome,
    createdAt: 0,
    resolvedAt: outcome === "pending" ? null : 1,
  };
}
