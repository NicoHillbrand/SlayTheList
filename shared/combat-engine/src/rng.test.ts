import { describe, expect, it } from "vitest";
import { makeRng } from "./rng";

describe("makeRng", () => {
  it("produces the same sequence for the same seed", () => {
    const a = makeRng(42);
    const b = makeRng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("produces different sequences for different seeds", () => {
    expect(makeRng(1)()).not.toBe(makeRng(2)());
  });

  it("stays within [0, 1)", () => {
    const rng = makeRng(123);
    for (let i = 0; i < 1000; i += 1) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
