/**
 * Browser-local review queue. Misses generate cards (BUILD_PLAN §6), and the
 * card is keyed by concept tag rather than by question — that is what lets a
 * mistake made in one repo come back when another repo tests the same idea
 * (§8). Same honest limit as the streak: this browser only, until the identity
 * layer lands (§10a).
 */

import { PASS_MARK } from "@/lib/grill/types";

export interface ReviewCard {
  tag: string;
  attempts: number;
  misses: number;
  /** Passes in a row since the last miss. Drives the interval and the mastery word. */
  streak: number;
  /** Local ISO date this concept comes back. */
  due: string;
  lastSeen: string;
  /**
   * Exact moment of the last answer. lastSeen is a date because the schedule
   * is, but a date cannot order two cards touched the same day, and something
   * has to when the queue is capped.
   */
  seenAt?: number;
  /**
   * The §3 layer the concept was last tested at. It is what orders a derived
   * curriculum: fundamentals before seams, without anybody authoring a syllabus.
   */
  layer?: number;
  /** Where it has come up, newest first. Cross-repo history is the point. */
  repos: string[];
  lastPrompt: string;
  lastScore: number | null;
}

const KEY = "td:review";
const CARD_CAP = 200;
const PROMPT_CAP = 200;
const REPO_CAP = 4;

export const REVIEW_EVENT = "td:review";

// Leitner-style fixed steps rather than SM-2 ease factors: one browser's worth
// of history is not enough data to fit a per-card ease to, and pretending
// otherwise would just be numerology.
const INTERVALS = [1, 3, 7, 16, 35];

function localDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

function valid(c: unknown): c is ReviewCard {
  const card = c as ReviewCard;
  return (
    typeof card?.tag === "string" &&
    card.tag.length > 0 &&
    typeof card.due === "string" &&
    typeof card.misses === "number"
  );
}

export function readCards(): ReviewCard[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(valid) : [];
  } catch {
    return []; // storage disabled, or a record from an older shape
  }
}

function write(cards: ReviewCard[]): void {
  try {
    // Keep the most recently seen when capped: an old card nobody has met in
    // months is the one worth dropping.
    const kept = [...cards]
      .sort((a, b) => (b.seenAt ?? 0) - (a.seenAt ?? 0) || b.lastSeen.localeCompare(a.lastSeen))
      .slice(0, CARD_CAP);
    window.localStorage.setItem(KEY, JSON.stringify(kept));
    window.dispatchEvent(new Event(REVIEW_EVENT));
  } catch {
    // private mode or a full quota: review is a nice-to-have, never a blocker
  }
}

/** Adopts the account's cards, keeping the local queue and the durable one one thing. */
export function hydrateCards(cards: ReviewCard[]): void {
  if (typeof window === "undefined") return;
  write(cards);
}

/** Concepts whose date has arrived. */
export function dueTags(cards = readCards()): string[] {
  const today = localDate();
  return cards.filter((c) => c.due <= today).map((c) => c.tag);
}

export function isDue(card: ReviewCard): boolean {
  return card.due <= localDate();
}

export type Mastery = "shaky" | "coming back" | "solid";

export function mastery(card: ReviewCard): Mastery {
  if (card.streak === 0) return "shaky";
  return card.streak >= 3 ? "solid" : "coming back";
}

/**
 * Records one graded answer against its concepts. A miss opens a card; a pass
 * only advances a card that already exists, because every correct answer
 * minting a card would bury the misses that matter.
 */
export function recordAnswer(input: {
  tags: string[];
  score: number | null;
  repo: string;
  prompt: string;
  /** The §3 layer this question sat at. */
  layer?: number;
  /** Answered with the ladder's help. Counts as a miss however it scored. */
  hinted?: boolean;
}): ReviewCard[] {
  if (typeof window === "undefined" || input.tags.length === 0) return [];
  const missed = input.hinted === true || input.score === null || input.score < PASS_MARK;
  const cards = readCards();
  const today = localDate();

  for (const tag of input.tags) {
    const at = cards.findIndex((c) => c.tag === tag);
    if (at === -1 && !missed) continue;

    const prev: ReviewCard =
      at === -1
        ? {
            tag,
            attempts: 0,
            misses: 0,
            streak: 0,
            due: today,
            lastSeen: today,
            repos: [],
            lastPrompt: "",
            lastScore: null,
          }
        : cards[at];

    const streak = missed ? 0 : prev.streak + 1;
    const next: ReviewCard = {
      tag,
      attempts: prev.attempts + 1,
      misses: prev.misses + (missed ? 1 : 0),
      streak,
      due: localDate(missed ? 1 : INTERVALS[Math.min(streak, INTERVALS.length) - 1]),
      lastSeen: today,
      seenAt: Date.now(),
      layer: input.layer ?? prev.layer,
      repos: [input.repo, ...prev.repos.filter((r) => r !== input.repo)].slice(0, REPO_CAP),
      lastPrompt: input.prompt.slice(0, PROMPT_CAP),
      lastScore: input.score,
    };
    if (at === -1) cards.push(next);
    else cards[at] = next;
  }

  write(cards);
  return cards;
}
