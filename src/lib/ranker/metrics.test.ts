import { describe, expect, it } from "vitest";
import { bootstrapCI, brier, logLoss, mrr, mulberry32, ndcgAtK, recallAtK } from "./metrics";

describe("ndcgAtK", () => {
  it("is 1 for a perfect ranking", () => {
    expect(ndcgAtK([1, 1, 0, 0], 3)).toBe(1);
  });

  it("matches the hand-computed value for a known case", () => {
    // Ranked rels [0, 1]: DCG = 1/log2(3), IDCG = 1/log2(2) = 1.
    expect(ndcgAtK([0, 1], 2)).toBeCloseTo(1 / Math.log2(3), 10);
  });

  it("is 1 when nothing is relevant (no ranking can do better)", () => {
    expect(ndcgAtK([0, 0, 0], 3)).toBe(1);
  });
});

describe("mrr", () => {
  it("is the reciprocal rank of the first hit", () => {
    expect(mrr([0, 0, 1, 1])).toBeCloseTo(1 / 3, 10);
    expect(mrr([1, 0])).toBe(1);
  });

  it("is 0 with no relevant item", () => {
    expect(mrr([0, 0])).toBe(0);
  });
});

describe("recallAtK", () => {
  it("counts relevant items in the top k", () => {
    expect(recallAtK([1, 0, 1, 1], 3)).toBeCloseTo(2 / 3, 10);
  });
});

describe("calibration", () => {
  it("brier rewards confident correct probabilities", () => {
    const sharp = brier([
      { p: 0.9, y: 1 },
      { p: 0.1, y: 0 },
    ]);
    const flat = brier([
      { p: 0.5, y: 1 },
      { p: 0.5, y: 0 },
    ]);
    expect(sharp).toBeLessThan(flat);
    expect(flat).toBeCloseTo(0.25, 10);
  });

  it("logLoss is finite even at clamped extremes", () => {
    expect(Number.isFinite(logLoss([{ p: 1, y: 0 }]))).toBe(true);
  });
});

describe("bootstrapCI", () => {
  it("is deterministic for a fixed seed", () => {
    const values = [0.2, 0.4, 0.9, 0.5, 0.7];
    const a = bootstrapCI(values, 500, 42);
    const b = bootstrapCI(values, 500, 42);
    expect(a).toEqual(b);
    expect(a.lo).toBeLessThanOrEqual(a.mean);
    expect(a.hi).toBeGreaterThanOrEqual(a.mean);
  });

  it("collapses to the mean for a single value", () => {
    expect(bootstrapCI([0.5])).toEqual({ mean: 0.5, lo: 0.5, hi: 0.5, n: 1 });
  });
});

describe("mulberry32", () => {
  it("streams the same numbers for the same seed", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
