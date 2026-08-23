import { KIND_TAGS } from "./tags";
import type { ReviewCard } from "../review";

/**
 * Mastery per concept tag (BUILD_PLAN §10a). §8 is emphatic that concepts stay
 * emergent, so nothing here is authored: a level is computed from the record of
 * their own answers, and the confidence is stated rather than implied, because
 * one lucky answer is not mastery and pretending otherwise is how progress bars
 * start lying.
 */

export type Level = "untested" | "shaky" | "learning" | "steady" | "owned";

export interface Mastery {
  tag: string;
  level: Level;
  /** 0-100, for a bar. Derived, and meaningless without `confident`. */
  score: number;
  /** False until they have answered it enough times for the level to mean anything. */
  confident: boolean;
  attempts: number;
  misses: number;
  streak: number;
  layer: number;
  repos: string[];
}

const CONFIDENT_AT = 3;

/**
 * Layers for the tags the deterministic generators produce. Not a taxonomy:
 * these are the slugs this codebase itself attaches to a question kind, so the
 * layer is already known for them. Model-written tags carry their own layer on
 * the card.
 */
const LAYER_BY_FIXED_TAG: Record<string, number> = Object.fromEntries(
  Object.entries({
    "route-handler": 2,
    "route-models": 2,
    imports: 3,
    "call-sites": 3,
    "field-refs": 3,
    "commit-scope": 3,
    scale: 4,
    overview: 4,
  }).flatMap(([kind, layer]) => (KIND_TAGS[kind] ?? []).map((tag) => [tag, layer])),
);

export function layerOf(card: ReviewCard): number {
  return card.layer ?? LAYER_BY_FIXED_TAG[card.tag] ?? 1;
}

export function masteryOf(card: ReviewCard): Mastery {
  const attempts = Math.max(card.attempts, 1);
  const hits = Math.max(0, card.attempts - card.misses);
  // Hit rate, then pulled towards the current streak: getting it right lately
  // matters more than having got it right once in March.
  const rate = hits / attempts;
  const recency = Math.min(1, card.streak / 3);
  const score = Math.round((rate * 0.6 + recency * 0.4) * 100);
  const confident = card.attempts >= CONFIDENT_AT;

  let level: Level;
  if (card.attempts === 0) level = "untested";
  else if (card.streak === 0) level = "shaky";
  else if (!confident) level = "learning";
  else if (score >= 80 && card.streak >= 3) level = "owned";
  else if (score >= 55) level = "steady";
  else level = "learning";

  return {
    tag: card.tag,
    level,
    score,
    confident,
    attempts: card.attempts,
    misses: card.misses,
    streak: card.streak,
    layer: layerOf(card),
    repos: card.repos,
  };
}

/** One number for a set of concepts, weighted by how much evidence each has. */
export function groupMastery(items: Mastery[]): { score: number; confident: boolean } {
  if (items.length === 0) return { score: 0, confident: false };
  const weight = (m: Mastery) => Math.min(m.attempts, 5) || 1;
  const total = items.reduce((sum, m) => sum + weight(m), 0);
  return {
    score: Math.round(items.reduce((sum, m) => sum + m.score * weight(m), 0) / total),
    confident: items.filter((m) => m.confident).length >= Math.ceil(items.length / 2),
  };
}
