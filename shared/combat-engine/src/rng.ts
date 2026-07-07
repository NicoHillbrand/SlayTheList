/**
 * Deterministic seeded PRNG (mulberry32). The whole point of the engine is
 * that `(inputs, seed)` always produce the same battle — so any future card
 * randomness must go through this, never `Math.random()`. Same seed in →
 * same sequence out, which is what makes async snapshot PvP verifiable.
 */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return function next(): number {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
