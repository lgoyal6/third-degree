import { describe, expect, it } from "vitest";
import type { AttemptRow } from "./dataset";
import { FEATURE_NAMES } from "./features";
import { assertNoLeakage, buildExamples, primarySplit, repoSlices } from "./split";

const KIND_MISS_RATE = FEATURE_NAMES.indexOf("kindMissRate");
const REPO_COVERAGE = FEATURE_NAMES.indexOf("repoCoverage");

function row(partial: Partial<AttemptRow>): AttemptRow {
  return {
    v: 1,
    t: 0,
    session: "s0",
    repo: "a/a",
    mode: "grill",
    position: 0,
    kind: "route-handler",
    layer: 2,
    tier: 1,
    tags: ["file-based-routing"],
    due: [],
    score: 100,
    hints: 0,
    latencyMs: 1000,
    missed: false,
    finished: true,
    nq: 5,
    ...partial,
  };
}

describe("buildExamples (prequential)", () => {
  it("features see only history from strictly earlier sessions", () => {
    const rows = [
      row({ t: 1000, session: "s1", missed: true, score: 0 }),
      row({ t: 2000, session: "s2", missed: true, score: 10 }),
      row({ t: 3000, session: "s3" }),
    ];
    const [g1, g2, g3] = buildExamples(rows);
    // First session of all time: no kind history, falls back to the neutral rate.
    expect(g1.examples[0].features[KIND_MISS_RATE]).toBe(0.5);
    expect(g1.examples[0].features[REPO_COVERAGE]).toBe(0);
    // Second session sees exactly one prior attempt on this kind, a miss.
    expect(g2.examples[0].features[KIND_MISS_RATE]).toBe(1);
    // Third sees two prior attempts, both misses; its own pass never leaks in.
    expect(g3.examples[0].features[KIND_MISS_RATE]).toBe(1);
    expect(g3.examples[0].features[REPO_COVERAGE]).toBeGreaterThan(0);
  });

  it("a session's own outcomes never inform its own features", () => {
    const rows = [
      row({ t: 1000, session: "s1", position: 0, missed: true, score: 0 }),
      row({ t: 1000, session: "s1", position: 1, missed: true, score: 0 }),
    ];
    const [g] = buildExamples(rows);
    // Both attempts share the pre-session snapshot: neutral, not 100% missed.
    expect(g.examples[0].features[KIND_MISS_RATE]).toBe(0.5);
    expect(g.examples[1].features[KIND_MISS_RATE]).toBe(0.5);
  });

  it("null-scored attempts are history but never labels", () => {
    const rows = [row({ t: 1000, session: "s1", score: null, missed: null })];
    const [g] = buildExamples(rows);
    expect(g.examples[0].y).toBeNull();
  });
});

describe("assertNoLeakage", () => {
  const groups = buildExamples([
    row({ t: 1000, session: "s1", repo: "a/a" }),
    row({ t: 2000, session: "s2", repo: "a/a" }),
    row({ t: 3000, session: "s3", repo: "b/b" }),
    row({ t: 4000, session: "s4", repo: "b/b" }),
  ]);

  it("passes a clean session + time split", () => {
    expect(() => assertNoLeakage(primarySplit(groups, 2500))).not.toThrow();
  });

  it("fails when an evaluation session is planted into training", () => {
    const split = primarySplit(groups, 2500);
    const leaky = { ...split, train: [...split.train, split.eval[0]] };
    expect(() => assertNoLeakage(leaky)).toThrow(/appears in training/);
  });

  it("fails when training reaches into evaluation time", () => {
    const split = primarySplit(groups, 2500);
    const late = { ...groups[3], session: "s5" };
    const leaky = { ...split, train: [...split.train, late] };
    expect(() => assertNoLeakage(leaky)).toThrow(/Leakage/);
  });

  it("repo slices never train on a holdout repo and respect its first event", () => {
    const slices = repoSlices(groups, ["b/b"]);
    expect(slices).toHaveLength(1);
    const slice = slices[0];
    expect(slice.train.every((g) => g.repo === "a/a")).toBe(true);
    expect(Math.max(...slice.train.map((g) => g.t))).toBeLessThan(3000);
    expect(() => assertNoLeakage(slice)).not.toThrow();
    const leaky = { ...slice, train: [...slice.train, slice.eval[0]] };
    expect(() => assertNoLeakage(leaky)).toThrow(/appears in training/);
  });
});
