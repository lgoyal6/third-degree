// Browser-local streak and points. Deliberately not server-side: the durable,
// identity-backed version needs the accounts layer that was cut (BUILD_PLAN
// §10a), so this resets on a cache clear and does not follow a user across
// devices. Accepted for now; §12.5 names share rate, not retention, as the
// metric that matters before M2.

export interface Progress {
  lastActiveDate: string; // local ISO date, no time
  current: number; // consecutive days
  longest: number;
  points: number;
}

const KEY = "td:progress";
const AWARDED_KEY = "td:awarded";
const AWARDED_CAP = 60;

export const PROGRESS_EVENT = "td:progress";
export const DECK_POINTS = 10;

function localDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

function read<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null; // storage disabled or a record from an older shape
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private mode or a full quota: progress is a nice-to-have, never a blocker
  }
}

export function readProgress(): Progress | null {
  const p = read<Progress>(KEY);
  if (!p || typeof p.current !== "number" || typeof p.points !== "number") return null;
  return p;
}

/**
 * Records one completion. The key makes it idempotent, because a score screen
 * that pays out again on every reload would make points meaningless.
 */
export function recordCompletion(key: string, points: number): Progress | null {
  if (typeof window === "undefined") return null;
  const awarded = read<string[]>(AWARDED_KEY) ?? [];
  if (awarded.includes(key)) return readProgress();

  const prev = readProgress();
  const today = localDate();
  let current = 1;
  if (prev?.lastActiveDate === today) current = Math.max(1, prev.current);
  else if (prev?.lastActiveDate === localDate(-1)) current = Math.max(1, prev.current) + 1;

  const next: Progress = {
    lastActiveDate: today,
    current,
    longest: Math.max(prev?.longest ?? 0, current),
    points: (prev?.points ?? 0) + Math.max(0, Math.round(points)),
  };
  write(KEY, next);
  write(AWARDED_KEY, [...awarded, key].slice(-AWARDED_CAP));
  window.dispatchEvent(new Event(PROGRESS_EVENT));
  return next;
}
