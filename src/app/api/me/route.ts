import { NextResponse } from "next/server";
import {
  currentSession,
  dropSession,
  oauthConfigured,
  sessionCookie,
  sessionId,
  updateSession,
} from "@/lib/auth/github";
import {
  forgetAccount,
  getState,
  getUser,
  putState,
  rememberUser,
  type AccountState,
  type Profile,
} from "@/lib/account/store";
import { mergeState } from "@/lib/account/merge";
import { normalizeTags } from "@/lib/learn/tags";
import type { Progress } from "@/lib/progress";
import type { ReviewCard } from "@/lib/review";
import type { ShelfEntry } from "@/lib/shelf";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CARDS = 200;
const MAX_SHELF = 30;
const MAX_FOCUS = 5;
const MAX_SCHOOL = 80;

const num = (value: unknown, cap: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(cap, Math.round(value))) : 0;
const text = (value: unknown, cap: number): string =>
  typeof value === "string" ? value.slice(0, cap) : "";
const date = (value: unknown): string => (typeof value === "string" && DATE.test(value) ? value : "");

/**
 * The browser's copy arrives here to be merged, so everything in it is
 * untrusted: shapes, sizes and counters all get clamped before they reach
 * durable storage.
 */
function cleanProgress(raw: unknown): Progress | null {
  const p = raw as Progress | null;
  if (!p || !date(p.lastActiveDate)) return null;
  return {
    lastActiveDate: date(p.lastActiveDate),
    current: num(p.current, 10_000),
    longest: num(p.longest, 10_000),
    points: num(p.points, 10_000_000),
  };
}

function cleanCards(raw: unknown): ReviewCard[] {
  if (!Array.isArray(raw)) return [];
  const out: ReviewCard[] = [];
  for (const item of raw.slice(0, MAX_CARDS)) {
    const card = item as ReviewCard;
    const [tag] = normalizeTags([card?.tag], 1);
    if (!tag || !date(card.due) || !date(card.lastSeen)) continue;
    out.push({
      tag,
      attempts: num(card.attempts, 10_000),
      misses: num(card.misses, 10_000),
      streak: num(card.streak, 10_000),
      due: date(card.due),
      lastSeen: date(card.lastSeen),
      seenAt: typeof card.seenAt === "number" ? num(card.seenAt, Date.now() + 86_400_000) : undefined,
      repos: (Array.isArray(card.repos) ? card.repos : []).slice(0, 4).map((r) => text(r, 120)).filter(Boolean),
      lastPrompt: text(card.lastPrompt, 200),
      lastScore: typeof card.lastScore === "number" ? num(card.lastScore, 100) : null,
    });
  }
  return out;
}

function cleanShelf(raw: unknown): ShelfEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ShelfEntry[] = [];
  for (const item of raw.slice(0, MAX_SHELF)) {
    const entry = item as ShelfEntry;
    const jobId = text(entry?.jobId, 64);
    const repo = text(entry?.repo, 120);
    if (!jobId || !repo || !date(entry.at)) continue;
    out.push({ jobId, repo, at: date(entry.at) });
  }
  return out;
}

async function me() {
  let session = await currentSession();
  if (!session) return null;

  // A session from before accounts existed holds a token and no identity.
  // Rather than showing its owner a sign-in link they already satisfied, ask
  // GitHub who they are once and upgrade the session in place.
  if (!session.userId) {
    const id = await sessionId();
    if (!id) return null;
    try {
      const res = await fetch("https://api.github.com/user", {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${session.token}`,
          "User-Agent": "third-degree-indexer",
        },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) return null;
      const account = (await res.json()) as { id?: number; login?: string; avatar_url?: string };
      if (!account.id || !account.login) return null;
      session = {
        ...session,
        userId: String(account.id),
        login: account.login,
        avatarUrl: account.avatar_url,
      };
      await rememberUser({ id: session.userId, login: session.login, avatarUrl: session.avatarUrl });
      await updateSession(id, session);
    } catch {
      return null;
    }
  }

  const user = await getUser(session.userId);
  return user ? { session, user } : null;
}

export async function GET() {
  const who = await me();
  if (!who) {
    return NextResponse.json({ signedIn: false, available: oauthConfigured() });
  }
  return NextResponse.json({
    signedIn: true,
    user: { login: who.user.login, avatarUrl: who.user.avatarUrl },
    scope: who.session.scope,
    state: await getState(who.user.id),
  });
}

/** Sync: the browser's copy in, the merged truth back out. */
export async function POST(request: Request) {
  const who = await me();
  if (!who) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: Partial<AccountState>;
  try {
    body = (await request.json()) as Partial<AccountState>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const merged = mergeState(await getState(who.user.id), {
    progress: cleanProgress(body.progress),
    review: cleanCards(body.review),
    shelf: cleanShelf(body.shelf),
    profile: {},
  });
  await putState(who.user.id, merged);
  return NextResponse.json({ state: merged });
}

/** Profile edits, which are deliberate and therefore replace rather than merge. */
export async function PATCH(request: Request) {
  const who = await me();
  if (!who) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: Profile;
  try {
    body = (await request.json()) as Profile;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const state = await getState(who.user.id);
  const profile: Profile = {
    school: text(body.school, MAX_SCHOOL).trim() || undefined,
    // A one-letter "concept" is a typo, not a focus.
    focus: normalizeTags(
      (Array.isArray(body.focus) ? body.focus : []).filter(
        (tag) => typeof tag === "string" && tag.trim().length >= 3,
      ),
      MAX_FOCUS,
    ),
  };
  await putState(who.user.id, { ...state, profile });
  return NextResponse.json({ profile });
}

/** Everything this account holds, deleted, and the session with it. */
export async function DELETE() {
  const who = await me();
  const id = await sessionId();
  if (who) await forgetAccount(who.user.id);
  if (id) await dropSession(id);
  const res = NextResponse.json({ signedIn: false, deleted: Boolean(who) });
  res.cookies.set(sessionCookie.name, "", { ...sessionCookie.options, maxAge: 0 });
  return res;
}
