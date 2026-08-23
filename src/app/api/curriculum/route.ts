import { NextResponse } from "next/server";
import { getJob } from "@/lib/jobs";
import { buildCurriculum } from "@/lib/learn/curriculum";
import { getState, putState } from "@/lib/account/store";
import { currentSession } from "@/lib/auth/github";
import { checkLimit } from "@/lib/ratelimit";
import { redis } from "@/lib/redis";
import { normalizeTags } from "@/lib/learn/tags";
import type { ReviewCard } from "@/lib/review";

// One grouping call at most, and only when the concept set has changed.
export const maxDuration = 120;

const MAX_CARDS = 200;
const cacheKey = (userId: string) => `curric:${userId}`;

/** The concepts and the repo it was built for: change either and it is stale. */
function fingerprint(cards: ReviewCard[], jobId: string | undefined): string {
  return `${jobId ?? "-"}::${cards.map((c) => `${c.tag}@${c.attempts}.${c.streak}`).sort().join(",")}`;
}

function cleanCards(raw: unknown): ReviewCard[] {
  if (!Array.isArray(raw)) return [];
  const out: ReviewCard[] = [];
  for (const item of raw.slice(0, MAX_CARDS)) {
    const card = item as ReviewCard;
    const [tag] = normalizeTags([card?.tag], 1);
    if (!tag) continue;
    out.push({
      ...card,
      tag,
      attempts: Math.max(0, Math.min(10_000, Math.round(card.attempts ?? 0))),
      misses: Math.max(0, Math.min(10_000, Math.round(card.misses ?? 0))),
      streak: Math.max(0, Math.min(10_000, Math.round(card.streak ?? 0))),
      repos: Array.isArray(card.repos) ? card.repos.slice(0, 4) : [],
    });
  }
  return out;
}

export async function POST(request: Request) {
  let body: { cards?: unknown; jobId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const jobId = typeof body.jobId === "string" ? body.jobId : undefined;
  const session = await currentSession();
  const userId = session?.userId || undefined;

  // The account's cards are the durable record; a signed-out browser sends its
  // own, because the path is not something to hold behind an account.
  const account = userId ? await getState(userId) : null;
  const cards = account?.review.length ? account.review : cleanCards(body.cards);
  if (cards.length === 0) {
    return NextResponse.json({ modules: [], mastery: [] });
  }

  const stamp = fingerprint(cards, jobId);
  if (userId) {
    const cached = await redis().get<{ stamp: string; curriculum: unknown }>(cacheKey(userId));
    if (cached?.stamp === stamp) return NextResponse.json(cached.curriculum);
  }

  const limited = await checkLimit(request, "curriculum");
  if (limited) return limited;

  const job = jobId ? await getJob(jobId) : undefined;
  const curriculum = await buildCurriculum(
    cards,
    job?.stage === "done" ? job.map : undefined,
  );

  if (userId) {
    await redis().set(cacheKey(userId), { stamp, curriculum });
    // Keep the profile's focus honest: a concept they have since dropped should
    // not keep steering sessions.
    const known = new Set(cards.map((c) => c.tag));
    const focus = (account?.profile.focus ?? []).filter((tag) => known.has(tag));
    if (account && focus.length !== (account.profile.focus ?? []).length) {
      await putState(userId, { ...account, profile: { ...account.profile, focus } });
    }
  }

  return NextResponse.json(curriculum);
}
