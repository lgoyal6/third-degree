import { FEATURE_NAMES, type KindStat } from "./features";

/**
 * The learned ranker: logistic regression over the nine features, trained with
 * full-batch gradient descent. Deliberately small and inspectable - every
 * weight can be read against its feature name, and training is deterministic
 * (zero init, fixed epochs, no data shuffling), so the same dataset always
 * yields the same artifact.
 */

export const MODEL_VERSION = "lr-v1";

export interface TrainedModel {
  version: string;
  featureNames: string[];
  /** Standardization parameters from the training split. */
  mean: number[];
  std: number[];
  weights: number[];
  bias: number;
  /** Any standardized feature beyond this is out of distribution. */
  zClip: number;
  /** Question kinds seen in training. Unseen kinds are the new-item cold start. */
  seenKinds: string[];
  /** Serve-time history summary, frozen at training time. */
  kindStats: Record<string, KindStat>;
  globalMissRate: number;
  trainedOn: {
    datasetVersion: string;
    sha256: string;
    rows: number;
    positives: number;
  };
}

export interface TrainOptions {
  epochs?: number;
  learningRate?: number;
  l2?: number;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export function standardize(X: number[][]): { mean: number[]; std: number[] } {
  const d = X[0]?.length ?? 0;
  const mean = new Array<number>(d).fill(0);
  const std = new Array<number>(d).fill(0);
  for (const x of X) for (let j = 0; j < d; j++) mean[j] += x[j] / X.length;
  for (const x of X) for (let j = 0; j < d; j++) std[j] += (x[j] - mean[j]) ** 2 / X.length;
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j]) || 1;
  return { mean, std };
}

export function trainLogistic(
  X: number[][],
  y: number[],
  opts: TrainOptions = {},
): { weights: number[]; bias: number; mean: number[]; std: number[] } {
  if (X.length === 0 || X.length !== y.length) throw new Error("Bad training data.");
  const { epochs = 400, learningRate = 0.5, l2 = 1e-3 } = opts;
  const d = X[0].length;
  const { mean, std } = standardize(X);
  const Z = X.map((x) => x.map((v, j) => (v - mean[j]) / std[j]));

  const w = new Array<number>(d).fill(0);
  let b = 0;
  const n = X.length;
  for (let epoch = 0; epoch < epochs; epoch++) {
    const gw = new Array<number>(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      const err = sigmoid(Z[i].reduce((sum, v, j) => sum + v * w[j], b)) - y[i];
      for (let j = 0; j < d; j++) gw[j] += (err * Z[i][j]) / n;
      gb += err / n;
    }
    for (let j = 0; j < d; j++) w[j] -= learningRate * (gw[j] + l2 * w[j]);
    b -= learningRate * gb;
  }
  return { weights: w, bias: b, mean, std };
}

export interface Prediction {
  /** Predicted probability that the question will be missed. */
  p: number;
  /** True when the input sits outside the training distribution. */
  ood: boolean;
}

export function predict(model: TrainedModel, features: number[]): Prediction {
  let z = model.bias;
  let ood = false;
  for (let j = 0; j < features.length; j++) {
    const zj = (features[j] - model.mean[j]) / model.std[j];
    if (Math.abs(zj) > model.zClip) ood = true;
    z += zj * model.weights[j];
  }
  return { p: sigmoid(z), ood };
}

const finiteArray = (v: unknown, length: number): v is number[] =>
  Array.isArray(v) && v.length === length && v.every((x) => typeof x === "number" && Number.isFinite(x));

/** A model that fails this is treated as absent: the baseline ranking runs. */
export function validateModel(value: unknown): value is TrainedModel {
  const m = value as TrainedModel;
  const d = FEATURE_NAMES.length;
  return (
    m != null &&
    m.version === MODEL_VERSION &&
    Array.isArray(m.featureNames) &&
    m.featureNames.length === d &&
    m.featureNames.every((name, i) => name === FEATURE_NAMES[i]) &&
    finiteArray(m.mean, d) &&
    finiteArray(m.std, d) &&
    m.std.every((s) => s > 0) &&
    finiteArray(m.weights, d) &&
    typeof m.bias === "number" &&
    Number.isFinite(m.bias) &&
    typeof m.zClip === "number" &&
    m.zClip > 0 &&
    Array.isArray(m.seenKinds) &&
    m.seenKinds.every((k) => typeof k === "string") &&
    typeof m.globalMissRate === "number" &&
    m.globalMissRate >= 0 &&
    m.globalMissRate <= 1 &&
    typeof m.kindStats === "object" &&
    m.kindStats !== null
  );
}
