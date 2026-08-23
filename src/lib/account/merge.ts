import type { Progress } from "../progress";
import type { ReviewCard } from "../review";
import type { ShelfEntry } from "../shelf";
import type { AccountState } from "./store";

/**
 * Merging a browser's copy into the account's. Every rule here is idempotent,
 * because the same payload gets pushed again on every reload and a merge that
 * added things up would inflate a streak by refreshing the page.
 */

const CARD_CAP = 200;

/** Millisecond stamp when there is one, else midnight of the date. */
function stamp(card: ReviewCard): number {
  return card.seenAt ?? (Date.parse(`${card.lastSeen}T00:00:00Z`) || 0);
}
const SHELF_CAP = 30;

function laterDate(a: string | undefined, b: string | undefined): string {
  return (a ?? "") >= (b ?? "") ? a ?? b ?? "" : b ?? "";
}

export function mergeProgress(mine: Progress | null, theirs: Progress | null): Progress | null {
  if (!mine) return theirs;
  if (!theirs) return mine;
  const lastActiveDate = laterDate(mine.lastActiveDate, theirs.lastActiveDate);
  return {
    lastActiveDate,
    // The streak belongs to whichever copy was active most recently; taking the
    // max would let a stale device resurrect a broken streak.
    current: mine.lastActiveDate === lastActiveDate ? mine.current : theirs.current,
    longest: Math.max(mine.longest, theirs.longest),
    points: Math.max(mine.points, theirs.points),
  };
}

export function mergeCards(mine: ReviewCard[], theirs: ReviewCard[]): ReviewCard[] {
  const byTag = new Map<string, ReviewCard>();
  for (const card of [...theirs, ...mine]) {
    const existing = byTag.get(card.tag);
    if (!existing) {
      byTag.set(card.tag, card);
      continue;
    }
    // The fresher record wins the schedule; counters take the maximum rather
    // than the sum, so re-pushing the same history changes nothing.
    const fresher = stamp(card) >= stamp(existing) ? card : existing;
    const other = fresher === card ? existing : card;
    byTag.set(card.tag, {
      ...fresher,
      attempts: Math.max(fresher.attempts, other.attempts),
      misses: Math.max(fresher.misses, other.misses),
      repos: [...new Set([...fresher.repos, ...other.repos])].slice(0, 4),
    });
  }
  // Ordered by when they were last answered, not by date alone: two hundred
  // cards touched the same day need a tiebreak, or the cap drops whichever the
  // iteration happened to reach last — including the one just added.
  return [...byTag.values()].sort((a, b) => stamp(b) - stamp(a)).slice(0, CARD_CAP);
}

export function mergeShelf(mine: ShelfEntry[], theirs: ShelfEntry[]): ShelfEntry[] {
  const byRepo = new Map<string, ShelfEntry>();
  for (const entry of [...mine, ...theirs]) {
    const existing = byRepo.get(entry.repo);
    // Same repo mapped twice: the newer map is the one worth keeping, since the
    // older job id will expire first.
    if (!existing || entry.at > existing.at) byRepo.set(entry.repo, entry);
  }
  return [...byRepo.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, SHELF_CAP);
}

export function mergeState(account: AccountState, incoming: Partial<AccountState>): AccountState {
  return {
    progress: mergeProgress(incoming.progress ?? null, account.progress),
    review: mergeCards(incoming.review ?? [], account.review),
    shelf: mergeShelf(incoming.shelf ?? [], account.shelf),
    // The profile is only ever edited on purpose, so it is not merged: whatever
    // the account holds stands until a PATCH replaces it.
    profile: account.profile,
  };
}
