import { randomUUID, randomBytes } from "node:crypto";
import { redis } from "../redis";
import type { GrillSession } from "./types";

// No TTL: share links are the growth loop (BUILD_PLAN §2) and must not rot.
const key = (id: string) => `grill:${id}`;
const slugKey = (slug: string) => `slug:${slug}`;

export async function createSession(
  base: Omit<GrillSession, "id" | "slug" | "createdAt" | "attempts" | "currentIndex">,
): Promise<GrillSession> {
  const session: GrillSession = {
    ...base,
    id: randomUUID(),
    slug: randomBytes(5).toString("base64url").replace(/[-_]/g, "a").toLowerCase(),
    attempts: [],
    currentIndex: 0,
    createdAt: Date.now(),
  };
  await Promise.all([
    redis().set(key(session.id), session),
    redis().set(slugKey(session.slug), session.id),
  ]);
  return session;
}

export async function getSession(id: string): Promise<GrillSession | undefined> {
  const session = await redis().get<GrillSession>(key(id));
  return session ?? undefined;
}

export async function getSessionBySlug(slug: string): Promise<GrillSession | undefined> {
  const id = await redis().get<string>(slugKey(slug));
  return id ? getSession(id) : undefined;
}

export async function saveSession(session: GrillSession): Promise<void> {
  await redis().set(key(session.id), session);
}
