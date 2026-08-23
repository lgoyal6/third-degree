import { Ratelimit } from "@upstash/ratelimit";
import { NextResponse } from "next/server";
import { redis } from "./redis";

// Free product + arbitrary repo downloads + LLM calls, so the expensive entry
// points are capped per IP from day one (BUILD_PLAN §9). Maps and grills each
// cost a repo download plus model calls; answers cost one grading call.
const LIMITS = {
  map: { tokens: 5, window: "1 h" },
  grill: { tokens: 5, window: "1 h" },
  answer: { tokens: 60, window: "1 h" },
  lessons: { tokens: 10, window: "1 h" },
  craft: { tokens: 8, window: "1 h" },
  // A cram is several grills: one checkout and one generation per repo.
  cram: { tokens: 2, window: "1 h" },
  curriculum: { tokens: 12, window: "1 h" },
  express: { tokens: 20, window: "1 h" },
  hint: { tokens: 80, window: "1 h" },
} as const;

export type LimitName = keyof typeof LIMITS;

const limiters = new Map<LimitName, Ratelimit>();

function limiter(name: LimitName): Ratelimit {
  let existing = limiters.get(name);
  if (!existing) {
    const { tokens, window } = LIMITS[name];
    existing = new Ratelimit({
      redis: redis(),
      limiter: Ratelimit.slidingWindow(tokens, window),
      prefix: `rl:${name}`,
    });
    limiters.set(name, existing);
  }
  return existing;
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

/**
 * Returns a 429 response when the caller is over the limit, otherwise null.
 */
export async function checkLimit(
  request: Request,
  name: LimitName,
): Promise<NextResponse | null> {
  const { success, reset } = await limiter(name).limit(clientIp(request));
  if (success) return null;
  const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
  return NextResponse.json(
    { error: "You've hit the free limit for now. Try again in a bit." },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}
