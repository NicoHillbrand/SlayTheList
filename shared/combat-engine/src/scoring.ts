import type { Prediction } from "@slaythelist/contracts";

/**
 * Quadratic (Brier) scoring rule expressed as a payout multiplier.
 *
 *   multiplier = 1 - 2·(f - o)²
 *
 * where `f` is the forecast probability (0..1) and `o` the outcome (1=hit,
 * 0=miss). This is a *proper* scoring rule: expected payout is maximized by
 * reporting your true belief, so overconfidence loses gold in expectation.
 * The economy trains calibration on its own — no policing required.
 */
export function scoreMultiplier(f: number, o: 0 | 1): number {
  return 1 - 2 * (f - o) ** 2;
}

/**
 * Net gold delta for a resolved bet. `confidencePct` is the stored 1..99
 * integer confidence. Returns a signed integer (gold is whole numbers) —
 * positive is a win, negative is a loss.
 */
export function betPayout(stake: number, confidencePct: number, outcome: "hit" | "miss"): number {
  const f = confidencePct / 100;
  const o: 0 | 1 = outcome === "hit" ? 1 : 0;
  return Math.round(stake * scoreMultiplier(f, o));
}

export interface CalibrationBucket {
  /** Confidence band centre (predictions rounded to the nearest 10%). */
  confidence: number;
  /** Mean stated confidence in the band (%). */
  predicted: number;
  /** Actual hit rate in the band (%). */
  actual: number;
  count: number;
}

export interface CalibrationStats {
  /** Number of resolved (hit|miss) predictions the stats are computed over. */
  resolved: number;
  /** Mean Brier score (lower = better); null when nothing is resolved yet. */
  brier: number | null;
  /** Reliability-diagram buckets, ascending by confidence. */
  buckets: CalibrationBucket[];
}

/**
 * Calibration summary over a set of predictions. Only resolved (hit|miss)
 * predictions count — pending ones are ignored. This is the "skill" stat
 * shown on a visitable profile, deliberately luck-independent (unlike gold
 * earnings, which fold in stake size and variance).
 */
export function computeCalibration(predictions: Prediction[]): CalibrationStats {
  const resolved = predictions.filter((p) => p.outcome === "hit" || p.outcome === "miss");
  if (resolved.length === 0) {
    return { resolved: 0, brier: null, buckets: [] };
  }

  let brierSum = 0;
  const bucketMap = new Map<number, { fSum: number; hits: number; count: number }>();

  for (const p of resolved) {
    const f = p.confidence / 100;
    const o = p.outcome === "hit" ? 1 : 0;
    brierSum += (f - o) ** 2;

    const key = Math.round(p.confidence / 10) * 10;
    const entry = bucketMap.get(key) ?? { fSum: 0, hits: 0, count: 0 };
    entry.fSum += p.confidence;
    entry.hits += o;
    entry.count += 1;
    bucketMap.set(key, entry);
  }

  const buckets: CalibrationBucket[] = [...bucketMap.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([confidence, e]) => ({
      confidence,
      predicted: e.fSum / e.count,
      actual: (e.hits / e.count) * 100,
      count: e.count,
    }));

  return { resolved: resolved.length, brier: brierSum / resolved.length, buckets };
}
