/**
 * The one-command offline evaluation for the learned question ranker.
 *
 *   npm run rank:eval
 *
 * Runs on the frozen dataset only (hash-checked against the committed
 * manifest), prints every baseline, slice, and confidence interval, runs the
 * shuffled-label negative control, and executes the leakage detector - both on
 * the real splits (must pass) and on a planted leak (must trip).
 *
 * Online results are explicitly out of scope: no experiment traffic has been
 * assigned yet, and this harness makes no claim about it.
 */
import { bootstrapCI, brier, logLoss, mulberry32, mrr, ndcgAtK, recallAtK } from "../src/lib/ranker/metrics";
import { predict } from "../src/lib/ranker/model";
import {
  assertNoLeakage,
  buildExamples,
  labeledExamples,
  primarySplit,
  repoSlices,
  type Example,
  type SessionGroup,
} from "../src/lib/ranker/split";
import { fitModel, loadFrozenDataset } from "./rank-common";

const K = 3;
const RANDOM_SEED = 42;
const SHUFFLE_SEED = 7;

type Scorer = (ex: Example, group: SessionGroup) => number;

function seedOf(session: string): number {
  let h = 2166136261;
  for (const ch of session) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h ^ RANDOM_SEED) >>> 0;
}

/** Labeled examples of a group, ordered by a scorer (desc, baseline order tiebreak). */
function rank(group: SessionGroup, scorer: Scorer): Example[] {
  const labeled = group.examples.filter((ex) => ex.y !== null);
  return labeled
    .map((ex, i) => ({ ex, score: scorer(ex, group), i }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ ex }) => ex);
}

interface RankerResult {
  name: string;
  ndcg: ReturnType<typeof bootstrapCI>;
  mrr: ReturnType<typeof bootstrapCI>;
  recall: ReturnType<typeof bootstrapCI>;
  coverage: number;
}

function evaluateRanker(name: string, groups: SessionGroup[], scorer: Scorer): RankerResult {
  // Sessions where ranking can matter: at least one miss AND one pass.
  const discriminative = groups.filter((g) => {
    const ys = g.examples.map((e) => e.y).filter((y): y is number => y !== null);
    return ys.length >= 2 && ys.some((y) => y === 1) && ys.some((y) => y === 0);
  });
  const rels = discriminative.map((g) => rank(g, scorer).map((ex) => ex.y as number));

  const kindsSurfaced = new Set<string>();
  const kindsAvailable = new Set<string>();
  for (const g of groups) {
    const ordered = rank(g, scorer);
    if (ordered.length === 0) continue;
    for (const ex of ordered) kindsAvailable.add(ex.row.kind);
    for (const ex of ordered.slice(0, K)) kindsSurfaced.add(ex.row.kind);
  }

  return {
    name,
    ndcg: bootstrapCI(rels.map((r) => ndcgAtK(r, K))),
    mrr: bootstrapCI(rels.map((r) => mrr(r))),
    recall: bootstrapCI(rels.map((r) => recallAtK(r, K))),
    coverage: kindsAvailable.size === 0 ? NaN : kindsSurfaced.size / kindsAvailable.size,
  };
}

const fmtCI = (ci: ReturnType<typeof bootstrapCI>) =>
  Number.isNaN(ci.mean) ? "     n/a          " : `${ci.mean.toFixed(3)} [${ci.lo.toFixed(3)}, ${ci.hi.toFixed(3)}]`;

function printRankerTable(results: RankerResult[], sessions: number): void {
  console.log(
    `  ${"ranker".padEnd(14)} ${"NDCG@3 [95% CI]".padEnd(22)} ${"MRR [95% CI]".padEnd(22)} ${"Recall@3 [95% CI]".padEnd(22)} coverage`,
  );
  for (const r of results) {
    console.log(
      `  ${r.name.padEnd(14)} ${fmtCI(r.ndcg).padEnd(22)} ${fmtCI(r.mrr).padEnd(22)} ${fmtCI(r.recall).padEnd(22)} ${Number.isNaN(r.coverage) ? "n/a" : r.coverage.toFixed(2)}`,
    );
  }
  console.log(`  (${sessions} discriminative evaluation sessions; bootstrap: 2000 resamples, seed 1337)`);
}

function calibrationRow(name: string, pairs: { p: number; y: number }[]): string {
  const acc =
    pairs.length === 0
      ? NaN
      : pairs.filter(({ p, y }) => (p >= 0.5 ? 1 : 0) === y).length / pairs.length;
  return `  ${name.padEnd(14)} ${brier(pairs).toFixed(3).padEnd(8)} ${logLoss(pairs).toFixed(3).padEnd(9)} ${acc.toFixed(3)}`;
}

function shuffledLabels(y: number[], seed: number): number[] {
  const rand = mulberry32(seed);
  const out = [...y];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function countLabeled(groups: SessionGroup[]): { n: number; misses: number } {
  const { y } = labeledExamples(groups);
  return { n: y.length, misses: y.filter((v) => v === 1).length };
}

function main(): void {
  const { manifest, rows } = loadFrozenDataset();
  console.log("== Third Degree learned ranking - offline evaluation ==");
  console.log(
    `dataset ${manifest.datasetVersion}  sha256 ${manifest.sha256.slice(0, 16)}...  ` +
      `rows ${manifest.rows} (${manifest.labeledRows} labeled)  sessions ${manifest.sessions}`,
  );
  console.log(`repos: ${Object.entries(manifest.repos).map(([r, n]) => `${r}=${n}`).join(", ")}`);
  console.log(`time range: ${manifest.timeRange.from} -> ${manifest.timeRange.to}`);
  console.log(`provenance: ${manifest.provenance}`);
  console.log("");

  const groups = buildExamples(rows);
  const split = primarySplit(groups, Date.parse(manifest.splits.primaryCutoff));
  const slices = repoSlices(groups, manifest.splits.evalRepos);

  // Leakage detector: the real splits must pass, a planted leak must trip it.
  assertNoLeakage(split);
  for (const slice of slices) assertNoLeakage(slice);
  let tripped = false;
  try {
    assertNoLeakage({ ...split, train: [...split.train, split.eval[0]] });
  } catch (err) {
    tripped = true;
    console.log(`leakage detector: PASS on real splits; planted leak tripped as expected:`);
    console.log(`  ${(err as Error).message}`);
  }
  if (!tripped) {
    console.error("leakage detector FAILED to trip on a planted leak - aborting.");
    process.exit(1);
  }
  console.log("");

  // -- primary split ------------------------------------------------------
  const trainStats = countLabeled(split.train);
  const evalStats = countLabeled(split.eval);
  console.log(`-- ${split.name} --`);
  console.log(
    `train: ${split.train.length} sessions, ${trainStats.n} labeled attempts (${trainStats.misses} misses)  ` +
      `eval: ${split.eval.length} sessions, ${evalStats.n} labeled attempts (${evalStats.misses} misses)`,
  );

  const model = fitModel(split.train, manifest);
  const trainY = labeledExamples(split.train).y;
  const control = fitModel(split.train, manifest, shuffledLabels(trainY, SHUFFLE_SEED));

  const kindRate = (kind: string): number => {
    const s = model.kindStats[kind];
    return s && s.attempts > 0 ? s.misses / s.attempts : model.globalMissRate;
  };

  const rankers: [string, Scorer][] = [
    ["current", (ex) => -ex.row.position],
    ["popularity", (ex) => kindRate(ex.row.kind)],
    ["random", (ex, g) => mulberry32(seedOf(g.session) + ex.row.position)()],
    ["learned", (ex) => predict(model, ex.features).p],
    ["shuffled-ctl", (ex) => predict(control, ex.features).p],
  ];

  const discriminative = split.eval.filter((g) => {
    const ys = g.examples.map((e) => e.y).filter((y): y is number => y !== null);
    return ys.length >= 2 && ys.some((y) => y === 1) && ys.some((y) => y === 0);
  }).length;

  console.log("");
  console.log("ranking (question order within an evaluation session; relevance = missed):");
  printRankerTable(
    rankers.map(([name, scorer]) => evaluateRanker(name, split.eval, scorer)),
    discriminative,
  );

  console.log("");
  console.log("calibration on all labeled evaluation attempts (predicting P(miss)):");
  console.log(`  ${"predictor".padEnd(14)} ${"Brier".padEnd(8)} ${"LogLoss".padEnd(9)} Acc@0.5`);
  const evalLabeled = labeledExamples(split.eval);
  const pairsOf = (p: (i: number) => number) =>
    evalLabeled.y.map((y, i) => ({ p: p(i), y }));
  console.log(calibrationRow("base-rate", pairsOf(() => model.globalMissRate)));
  console.log(calibrationRow("popularity", pairsOf((i) => kindRate(evalLabeled.rows[i].kind))));
  console.log(calibrationRow("learned", pairsOf((i) => predict(model, evalLabeled.X[i]).p)));
  console.log(calibrationRow("shuffled-ctl", pairsOf((i) => predict(control, evalLabeled.X[i]).p)));

  console.log("");
  console.log("learned model weights (standardized features):");
  model.featureNames.forEach((name, i) => {
    console.log(`  ${name.padEnd(16)} ${model.weights[i] >= 0 ? " " : ""}${model.weights[i].toFixed(4)}`);
  });
  console.log(`  bias              ${model.bias >= 0 ? " " : ""}${model.bias.toFixed(4)}`);

  // -- repo holdout slices -------------------------------------------------
  console.log("");
  console.log("-- repo holdout slices (a repository the ranker has never trained on) --");
  for (const slice of slices) {
    const sliceTrain = countLabeled(slice.train);
    const sliceEval = countLabeled(slice.eval);
    console.log(`${slice.name}`);
    console.log(
      `  train: ${slice.train.length} sessions, ${sliceTrain.n} labeled  ` +
        `eval: ${slice.eval.length} sessions, ${sliceEval.n} labeled (${sliceEval.misses} misses)`,
    );
    if (sliceTrain.n === 0 || sliceEval.n === 0) {
      console.log("  skipped: not enough labeled data on one side.");
      continue;
    }
    const sliceModel = fitModel(slice.train, manifest);
    const sliceKindRate = (kind: string): number => {
      const s = sliceModel.kindStats[kind];
      return s && s.attempts > 0 ? s.misses / s.attempts : sliceModel.globalMissRate;
    };
    const labeled = labeledExamples(slice.eval);
    const pairs = (p: (i: number) => number) => labeled.y.map((y, i) => ({ p: p(i), y }));
    console.log(`  ${"predictor".padEnd(14)} ${"Brier".padEnd(8)} ${"LogLoss".padEnd(9)} Acc@0.5`);
    console.log(calibrationRow("base-rate", pairs(() => sliceModel.globalMissRate)));
    console.log(calibrationRow("popularity", pairs((i) => sliceKindRate(labeled.rows[i].kind))));
    console.log(calibrationRow("learned", pairs((i) => predict(sliceModel, labeled.X[i]).p)));
    const oodShare =
      labeled.X.filter((x) => predict(sliceModel, x).ood).length / labeled.X.length;
    console.log(`  out-of-distribution share: ${(oodShare * 100).toFixed(0)}% (the product falls back on these)`);
  }

  console.log("");
  console.log(
    "NOTE: everything above is offline replay of real, thin traffic. The online",
  );
  console.log(
    "holdout is instrumented (deterministic arms, exposure logs) but UNVERIFIED:",
  );
  console.log("no assigned traffic exists yet, and no online improvement is claimed.");
}

main();
