import { readFileSync } from "node:fs";
import path from "node:path";
import {
  DATASET_FILE,
  MANIFEST_FILE,
  parseRows,
  sha256Hex,
  type AttemptRow,
  type Manifest,
} from "../src/lib/ranker/dataset";
import { FEATURE_NAMES, type KindStat } from "../src/lib/ranker/features";
import { MODEL_VERSION, trainLogistic, type TrainedModel } from "../src/lib/ranker/model";
import { labeledExamples, type SessionGroup } from "../src/lib/ranker/split";

/** Loads the dataset and refuses to run when it does not match the manifest. */
export function loadFrozenDataset(root = process.cwd()): { manifest: Manifest; rows: AttemptRow[] } {
  const manifest = JSON.parse(readFileSync(path.join(root, MANIFEST_FILE), "utf8")) as Manifest;
  const jsonl = readFileSync(path.join(root, DATASET_FILE), "utf8");
  const sha = sha256Hex(jsonl);
  if (sha !== manifest.sha256) {
    throw new Error(
      `Dataset drift: ${DATASET_FILE} hashes to ${sha}, manifest pins ${manifest.sha256}. ` +
        "Rebuild with npm run rank:dataset or restore the frozen file.",
    );
  }
  return { manifest, rows: parseRows(jsonl) };
}

/** Fits the ranker on the training groups; the artifact carries its own history summary. */
export function fitModel(
  train: SessionGroup[],
  manifest: Manifest,
  labels?: number[],
): TrainedModel {
  const { X, y, rows } = labeledExamples(train);
  const target = labels ?? y;
  const fit = trainLogistic(X, target);

  const kindStats: Record<string, KindStat> = {};
  let misses = 0;
  for (let i = 0; i < rows.length; i++) {
    const kind = (kindStats[rows[i].kind] ??= { attempts: 0, misses: 0 });
    kind.attempts++;
    if (y[i] === 1) {
      kind.misses++;
      misses++;
    }
  }

  return {
    version: MODEL_VERSION,
    featureNames: [...FEATURE_NAMES],
    ...fit,
    zClip: 6,
    seenKinds: Object.keys(kindStats).sort(),
    kindStats,
    globalMissRate: rows.length > 0 ? misses / rows.length : 0.5,
    trainedOn: {
      datasetVersion: manifest.datasetVersion,
      sha256: manifest.sha256,
      rows: rows.length,
      positives: target.filter((v) => v === 1).length,
    },
  };
}
