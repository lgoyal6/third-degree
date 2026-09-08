/**
 * Trains the product's ranking artifact on the frozen dataset's training split
 * (the same split the eval harness scores, so the shipped weights are the
 * evaluated ones) and writes src/lib/ranker/model.v1.json.
 *
 * Usage: npm run rank:train
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { buildExamples, primarySplit, assertNoLeakage } from "../src/lib/ranker/split";
import { fitModel, loadFrozenDataset } from "./rank-common";

const ARTIFACT = "src/lib/ranker/model.v1.json";

const { manifest, rows } = loadFrozenDataset();
const groups = buildExamples(rows);
const split = primarySplit(groups, Date.parse(manifest.splits.primaryCutoff));
assertNoLeakage(split);

const model = fitModel(split.train, manifest);
writeFileSync(path.join(process.cwd(), ARTIFACT), JSON.stringify(model, null, 2) + "\n");

console.log(`wrote ${ARTIFACT}`);
console.log(`trained on ${model.trainedOn.rows} labeled attempts (${model.trainedOn.positives} misses)`);
console.log("weights:");
model.featureNames.forEach((name, i) => {
  console.log(`  ${name.padEnd(16)} ${model.weights[i].toFixed(4)}`);
});
console.log(`  bias             ${model.bias.toFixed(4)}`);
