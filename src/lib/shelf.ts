/**
 * The repo shelf, browser-local (BUILD_PLAN §7 screen 5). It is described there
 * as an auth'd surface, and the accounts layer is still deferred (§10a), so
 * this remembers what this browser mapped — same honest limit as the streak and
 * the review queue, and stated on the screen.
 */

export interface ShelfEntry {
  jobId: string;
  repo: string; // owner/name
  at: string; // local ISO date it was mapped
}

const KEY = "td:shelf";
const CAP = 30;
export const SHELF_EVENT = "td:shelf";

function localDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function readShelf(): ShelfEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is ShelfEntry =>
        typeof (e as ShelfEntry)?.jobId === "string" && typeof (e as ShelfEntry)?.repo === "string",
    );
  } catch {
    return [];
  }
}

/** Called when a map finishes. Newest first, one entry per repo. */
export function remember(jobId: string, repo: string): void {
  if (typeof window === "undefined") return;
  const next = [{ jobId, repo, at: localDate() }, ...readShelf().filter((e) => e.repo !== repo)].slice(
    0,
    CAP,
  );
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(SHELF_EVENT));
  } catch {
    // private mode or a full quota: the shelf is a convenience, never a blocker
  }
}

export function forget(jobId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(readShelf().filter((e) => e.jobId !== jobId)));
    window.dispatchEvent(new Event(SHELF_EVENT));
  } catch {
    // ignore
  }
}
