import { describe, expect, it } from "vitest";
import { coldContext, featuresOf, tagSimilarity, FEATURE_NAMES } from "./features";
import { mulberry32 } from "./metrics";
import {
  MODEL_VERSION,
  predict,
  trainLogistic,
  validateModel,
  type TrainedModel,
} from "./model";

/** Synthetic separable data: y follows feature 3 plus noise. Planted, seeded. */
function planted(n: number, seed: number): { X: number[][]; y: number[] } {
  const rand = mulberry32(seed);
  const X: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    const signal = rand();
    const x = FEATURE_NAMES.map(() => rand());
    x[3] = signal;
    X.push(x);
    y.push(signal + (rand() - 0.5) * 0.4 > 0.5 ? 1 : 0);
  }
  return { X, y };
}

function modelFrom(X: number[][], y: number[]): TrainedModel {
  const fit = trainLogistic(X, y);
  return {
    version: MODEL_VERSION,
    featureNames: [...FEATURE_NAMES],
    ...fit,
    zClip: 6,
    seenKinds: ["snippet"],
    kindStats: {},
    globalMissRate: 0.5,
    trainedOn: { datasetVersion: "test", sha256: "x", rows: X.length, positives: y.filter(Boolean).length },
  };
}

function separation(model: TrainedModel, X: number[][], y: number[]): number {
  const pos: number[] = [];
  const neg: number[] = [];
  X.forEach((x, i) => (y[i] === 1 ? pos : neg).push(predict(model, x).p));
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  return mean(pos) - mean(neg);
}

describe("trainLogistic", () => {
  it("is deterministic: same data, same weights", () => {
    const { X, y } = planted(200, 11);
    const a = trainLogistic(X, y);
    const b = trainLogistic(X, y);
    expect(a).toEqual(b);
  });

  it("recovers a planted signal", () => {
    const { X, y } = planted(300, 12);
    const model = modelFrom(X, y);
    expect(separation(model, X, y)).toBeGreaterThan(0.2);
    // The planted feature carries the largest weight.
    const magnitudes = model.weights.map(Math.abs);
    expect(magnitudes.indexOf(Math.max(...magnitudes))).toBe(3);
  });

  it("shuffled labels destroy the signal (negative control)", () => {
    const { X, y } = planted(300, 12);
    const rand = mulberry32(99);
    const shuffled = [...y];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const control = modelFrom(X, shuffled);
    // Separation measured against the TRUE labels collapses to about zero.
    expect(Math.abs(separation(control, X, y))).toBeLessThan(0.05);
  });
});

describe("predict", () => {
  it("flags out-of-distribution inputs instead of trusting them", () => {
    const { X, y } = planted(100, 13);
    const model = modelFrom(X, y);
    const inside = predict(model, X[0]);
    expect(inside.ood).toBe(false);
    const far = X[0].map(() => 1e6);
    expect(predict(model, far).ood).toBe(true);
  });
});

describe("validateModel", () => {
  it("accepts a well-formed model and rejects broken ones", () => {
    const { X, y } = planted(50, 14);
    const model = modelFrom(X, y);
    expect(validateModel(model)).toBe(true);
    expect(validateModel(undefined)).toBe(false);
    expect(validateModel({ ...model, version: "other" })).toBe(false);
    expect(validateModel({ ...model, weights: model.weights.slice(1) })).toBe(false);
    expect(validateModel({ ...model, weights: model.weights.map(() => NaN) })).toBe(false);
    expect(validateModel({ ...model, std: model.std.map(() => 0) })).toBe(false);
  });
});

describe("features", () => {
  it("tagSimilarity: exact match beats token overlap beats nothing", () => {
    expect(tagSimilarity(["import-blast-radius"], ["import-blast-radius"])).toBe(1);
    const soft = tagSimilarity(["call-site-blast-radius"], ["import-blast-radius"]);
    expect(soft).toBeGreaterThan(0);
    expect(soft).toBeLessThan(1);
    expect(tagSimilarity(["stale-closure"], ["file-based-routing"])).toBe(0);
    expect(tagSimilarity([], ["anything"])).toBe(0);
  });

  it("cold context yields deterministic neutral features", () => {
    const ctx = coldContext({}, 0.5);
    const q = { kind: "route-handler", layer: 2, gradingTier: 1, conceptTags: ["file-based-routing"] };
    const a = featuresOf(q, ctx);
    const b = featuresOf(q, ctx);
    expect(a).toEqual(b);
    expect(a).toHaveLength(FEATURE_NAMES.length);
    expect(a[3]).toBe(0.5); // kindMissRate falls back to the global rate
    expect(a[5]).toBe(0.5); // prereqReadiness neutral with no history
    expect(a[8]).toBe(1); // recency saturated: never grilled
  });
});
