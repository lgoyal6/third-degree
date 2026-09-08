/**
 * The feature vector behind the learned question ranker. One code path serves
 * both worlds: offline (history reconstructed prequentially from the dataset)
 * and the product at serve time (history summarized in the model artifact plus
 * the due tags the client sent). Everything is computed locally - the
 * "semantic similarity" feature is lexical tag overlap, because this repo has
 * no stored embeddings and buying some was out of scope.
 */

export const FEATURE_NAMES = [
  "layer", // where on the BUILD_PLAN §3 ladder the question sits
  "tier3", // graded by groundedness (open prose) rather than exact keys
  "dueSim", // similarity between the question's concepts and the user's due (missed) concepts
  "kindMissRate", // how often this question kind was missed historically
  "kindSupport", // how much evidence backs that rate
  "prereqReadiness", // pass rate on lower layers, from this repo's history
  "repoCoverage", // how much of this repo the user has already been grilled on
  "priorCompletion", // share of this repo's prior sessions that reached a verdict
  "recency", // days since the repo was last grilled, capped
] as const;

export interface KindStat {
  attempts: number;
  misses: number;
}

export interface FeatureContext {
  /** Concepts the review queue asked to resurface. Empty for a new user. */
  dueTags: string[];
  /** Per-kind outcome history (global across repos). */
  kindStats: Record<string, KindStat>;
  /** Fallback miss rate when a kind has no history. */
  globalMissRate: number;
  /** Per-layer outcome history for this repo. Empty for a new repository. */
  layerStats: Record<number, { attempts: number; passes: number }>;
  repoAttempts: number;
  repoSessions: number;
  repoFinishedSessions: number;
  /** Null when this repo has never been grilled. */
  daysSinceLastAttempt: number | null;
}

export interface RankableQuestion {
  kind: string;
  layer: number;
  gradingTier: number;
  conceptTags?: string[];
}

/** Deterministic cold-start context: a new user on a new repository. */
export function coldContext(
  kindStats: Record<string, KindStat>,
  globalMissRate: number,
  dueTags: string[] = [],
): FeatureContext {
  return {
    dueTags,
    kindStats,
    globalMissRate,
    layerStats: {},
    repoAttempts: 0,
    repoSessions: 0,
    repoFinishedSessions: 0,
    daysSinceLastAttempt: null,
  };
}

/**
 * Exact tag match wins; otherwise Jaccard overlap of hyphen-split tokens, so
 * "import-blast-radius" and "call-site-blast-radius" register as neighbors.
 */
export function tagSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  if (a.some((tag) => setB.has(tag))) return 1;
  const tokens = (tags: string[]) => new Set(tags.flatMap((t) => t.split("-")).filter(Boolean));
  const ta = tokens(a);
  const tb = tokens(b);
  let shared = 0;
  for (const tok of ta) if (tb.has(tok)) shared++;
  const union = ta.size + tb.size - shared;
  return union === 0 ? 0 : shared / union;
}

const SUPPORT_SCALE = Math.log1p(50);
const RECENCY_CAP_DAYS = 14;

export function featuresOf(q: RankableQuestion, ctx: FeatureContext): number[] {
  const kind = ctx.kindStats[q.kind];
  const kindMissRate = kind && kind.attempts > 0 ? kind.misses / kind.attempts : ctx.globalMissRate;
  const kindSupport = Math.min(1, Math.log1p(kind?.attempts ?? 0) / SUPPORT_SCALE);

  let lowerAttempts = 0;
  let lowerPasses = 0;
  for (const [layer, stat] of Object.entries(ctx.layerStats)) {
    if (Number(layer) < q.layer) {
      lowerAttempts += stat.attempts;
      lowerPasses += stat.passes;
    }
  }
  const prereqReadiness = lowerAttempts > 0 ? lowerPasses / lowerAttempts : 0.5;

  const priorCompletion =
    ctx.repoSessions > 0 ? ctx.repoFinishedSessions / ctx.repoSessions : 0.5;
  const recency =
    ctx.daysSinceLastAttempt === null
      ? 1
      : Math.min(ctx.daysSinceLastAttempt, RECENCY_CAP_DAYS) / RECENCY_CAP_DAYS;

  return [
    (q.layer - 1) / 3,
    q.gradingTier === 3 ? 1 : 0,
    tagSimilarity(q.conceptTags ?? [], ctx.dueTags),
    kindMissRate,
    kindSupport,
    prereqReadiness,
    Math.min(1, Math.log1p(ctx.repoAttempts) / SUPPORT_SCALE),
    priorCompletion,
    recency,
  ];
}
