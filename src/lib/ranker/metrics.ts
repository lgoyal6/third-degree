/**
 * Offline ranking and calibration metrics for the question ranker, plus a
 * seeded bootstrap for confidence intervals. Pure functions, no dependencies.
 */

/** Deterministic PRNG so every eval run and test prints the same numbers. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** NDCG@k over binary relevances given in ranked order. 1 when no positive exists. */
export function ndcgAtK(ranked: number[], k: number): number {
  const gains = ranked.slice(0, k);
  const dcg = gains.reduce((sum, rel, i) => sum + rel / Math.log2(i + 2), 0);
  const ideal = [...ranked].sort((a, b) => b - a).slice(0, k);
  const idcg = ideal.reduce((sum, rel, i) => sum + rel / Math.log2(i + 2), 0);
  return idcg === 0 ? 1 : dcg / idcg;
}

/** Reciprocal rank of the first relevant item; 0 when none exists. */
export function mrr(ranked: number[]): number {
  const at = ranked.findIndex((rel) => rel > 0);
  return at === -1 ? 0 : 1 / (at + 1);
}

/** Share of relevant items surfaced in the top k. 1 when no positive exists. */
export function recallAtK(ranked: number[], k: number): number {
  const total = ranked.reduce((sum, rel) => sum + (rel > 0 ? 1 : 0), 0);
  if (total === 0) return 1;
  const found = ranked.slice(0, k).reduce((sum, rel) => sum + (rel > 0 ? 1 : 0), 0);
  return found / total;
}

/** Mean squared error of predicted probabilities against 0/1 outcomes. */
export function brier(pairs: { p: number; y: number }[]): number {
  if (pairs.length === 0) return NaN;
  return pairs.reduce((sum, { p, y }) => sum + (p - y) ** 2, 0) / pairs.length;
}

export function logLoss(pairs: { p: number; y: number }[]): number {
  if (pairs.length === 0) return NaN;
  const eps = 1e-9;
  return (
    -pairs.reduce((sum, { p, y }) => {
      const q = Math.min(1 - eps, Math.max(eps, p));
      return sum + (y === 1 ? Math.log(q) : Math.log(1 - q));
    }, 0) / pairs.length
  );
}

export interface CI {
  mean: number;
  lo: number;
  hi: number;
  n: number;
}

/**
 * Percentile bootstrap over per-unit values (one value per evaluation session).
 * Seeded, so the interval is reproducible.
 */
export function bootstrapCI(values: number[], iterations = 2000, seed = 1337): CI {
  const n = values.length;
  const mean = n === 0 ? NaN : values.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { mean, lo: mean, hi: mean, n };
  const rand = mulberry32(seed);
  const means: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) sum += values[Math.floor(rand() * n)];
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  return {
    mean,
    lo: means[Math.floor(0.025 * iterations)],
    hi: means[Math.min(iterations - 1, Math.floor(0.975 * iterations))],
    n,
  };
}
