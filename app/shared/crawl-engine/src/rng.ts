/**
 * Deterministic seeded PRNG (mulberry32) — same algorithm as the arena's
 * `@slaythelist/combat-engine`, deliberately duplicated rather than imported:
 * that package resolves its internal imports extensionlessly and only ever
 * loads through the Next bundler, while this one is required by the API under
 * Node ESM. Eight lines is a cheaper price than making the two packages agree
 * on module resolution.
 *
 * All shuffling and reward rolling must go through this so a run replays
 * identically from (seed, actions).
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

/** Fisher-Yates using `rng`. Returns a new array; the input is untouched. */
export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
