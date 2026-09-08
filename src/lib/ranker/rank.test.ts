import { describe, expect, it } from "vitest";
import type { GrillQuestion } from "../grill/types";
import { FEATURE_NAMES } from "./features";
import { MODEL_VERSION, type TrainedModel } from "./model";
import { rankWithinLayers } from "./rank";

const KIND_MISS_RATE = FEATURE_NAMES.indexOf("kindMissRate");

function question(id: string, kind: GrillQuestion["kind"], layer: GrillQuestion["layer"]): GrillQuestion {
  return {
    id,
    kind,
    layer,
    prompt: `q-${id}`,
    groundTruth: { reveal: "x" },
    gradingTier: 1,
    conceptTags: [kind],
  };
}

/** A model whose only opinion is the per-kind miss rate. */
function model(overrides: Partial<TrainedModel> = {}): TrainedModel {
  const d = FEATURE_NAMES.length;
  const weights = new Array<number>(d).fill(0);
  weights[KIND_MISS_RATE] = 4;
  return {
    version: MODEL_VERSION,
    featureNames: [...FEATURE_NAMES],
    mean: new Array<number>(d).fill(0.5),
    std: new Array<number>(d).fill(0.5),
    weights,
    bias: 0,
    zClip: 6,
    seenKinds: ["fundamental", "snippet", "route-handler", "route-models", "imports", "field-refs"],
    kindStats: {
      fundamental: { attempts: 10, misses: 2 },
      snippet: { attempts: 10, misses: 9 },
      "route-handler": { attempts: 10, misses: 1 },
      "route-models": { attempts: 10, misses: 8 },
      imports: { attempts: 10, misses: 5 },
      "field-refs": { attempts: 10, misses: 6 },
    },
    globalMissRate: 0.5,
    trainedOn: { datasetVersion: "test", sha256: "x", rows: 60, positives: 31 },
    ...overrides,
  };
}

const baseline = () => [
  question("a", "fundamental", 1),
  question("b", "snippet", 1),
  question("c", "route-handler", 2),
  question("d", "route-models", 2),
  question("e", "imports", 3),
  question("f", "field-refs", 3),
];

describe("rankWithinLayers fallback", () => {
  it("no model: the baseline order comes back untouched", () => {
    const qs = baseline();
    expect(rankWithinLayers(qs, { dueTags: ["stale-closure"] })).toBe(qs);
  });

  it("invalid model: treated as absent", () => {
    const qs = baseline();
    const broken = model({ weights: model().weights.map(() => NaN) });
    expect(rankWithinLayers(qs, {}, broken)).toBe(qs);
  });

  it("out-of-distribution input: every question keeps its slot", () => {
    const qs = baseline();
    // Standardization so tight that any real feature vector lands beyond zClip.
    const tight = model({ std: model().std.map(() => 1e-9) });
    expect(rankWithinLayers(qs, {}, tight).map((q) => q.id)).toEqual(qs.map((q) => q.id));
  });
});

describe("rankWithinLayers learned path", () => {
  it("reorders within a layer by predicted miss probability, never across layers", () => {
    const qs = baseline();
    const ranked = rankWithinLayers(qs, {}, model());
    // Layer sequence unchanged, harder kind first inside each layer.
    expect(ranked.map((q) => q.layer)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(ranked.map((q) => q.id)).toEqual(["b", "a", "d", "c", "f", "e"]);
    // Same questions, nothing dropped or invented.
    expect([...ranked].sort((x, y) => x.id.localeCompare(y.id))).toEqual(
      [...qs].sort((x, y) => x.id.localeCompare(y.id)),
    );
  });

  it("new user cold start: no due tags, deterministic global-difficulty order", () => {
    const a = rankWithinLayers(baseline(), {}, model());
    const b = rankWithinLayers(baseline(), { dueTags: [] }, model());
    expect(a.map((q) => q.id)).toEqual(b.map((q) => q.id));
  });

  it("new item cold start: an unseen kind keeps its baseline slot", () => {
    const qs = [
      question("a", "fundamental", 1),
      question("x", "commit-scope", 3), // never trained on
      question("e", "imports", 3),
      question("f", "field-refs", 3),
    ];
    const ranked = rankWithinLayers(qs, {}, model());
    // Slot 1 still holds the unseen kind; the seen layer-3 kinds swap around it.
    expect(ranked[1].id).toBe("x");
    expect(ranked.map((q) => q.id)).toEqual(["a", "x", "f", "e"]);
  });

  it("never mutates its input", () => {
    const qs = baseline();
    const ids = qs.map((q) => q.id);
    rankWithinLayers(qs, {}, model());
    expect(qs.map((q) => q.id)).toEqual(ids);
  });
});
