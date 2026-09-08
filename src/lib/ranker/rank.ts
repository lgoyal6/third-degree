import type { GrillQuestion } from "../grill/types";
import { coldContext, featuresOf } from "./features";
import { predict, validateModel, type TrainedModel } from "./model";

/**
 * Learned re-ranking of an assembled grill session, with the current behavior
 * as the safe fallback. The ladder is sacred (BUILD_PLAN §3/§4: climb from the
 * ground up), so the learned model only reorders questions *within* a layer -
 * by predicted miss probability, highest first, because the question most
 * likely to sting is the one worth the session's limited slots.
 *
 * Fallback and cold-start policy, all deterministic:
 * - No model, an invalid model, or a disabled ranker: the baseline order is
 *   returned untouched.
 * - New user (no due tags, no history): ranking still runs, on the global
 *   difficulty priors frozen in the artifact - same input, same order, always.
 * - New repository: server-side repo history does not exist yet, so repo
 *   features sit at their neutral cold-start values from the artifact.
 * - New question kind (a curriculum item the model never trained on), or a
 *   feature vector outside the training distribution: that question keeps its
 *   baseline slot; only in-distribution questions are reordered around it.
 */
export interface RankInputs {
  /** Concepts the review queue asked to resurface. Empty for a new user. */
  dueTags?: string[];
}

export function rankWithinLayers(
  questions: GrillQuestion[],
  inputs: RankInputs = {},
  model?: TrainedModel,
): GrillQuestion[] {
  if (!model || !validateModel(model)) return questions;

  const ctx = coldContext(model.kindStats, model.globalMissRate, inputs.dueTags ?? []);
  const seen = new Set(model.seenKinds);

  // Score what the model is entitled to score; everything else keeps its slot.
  const scores = questions.map((q) => {
    if (!seen.has(q.kind)) return null; // new-item cold start
    const { p, ood } = predict(model, featuresOf(q, ctx));
    return ood ? null : p;
  });

  const out = [...questions];
  for (const layer of new Set(questions.map((q) => q.layer))) {
    const slots: number[] = [];
    for (let i = 0; i < questions.length; i++) {
      if (questions[i].layer === layer && scores[i] !== null) slots.push(i);
    }
    if (slots.length < 2) continue;
    const reordered = [...slots].sort(
      (a, b) => (scores[b] as number) - (scores[a] as number) || a - b,
    );
    slots.forEach((slot, at) => {
      out[slot] = questions[reordered[at]];
    });
  }
  return out;
}
