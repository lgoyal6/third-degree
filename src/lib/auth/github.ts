import { randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redis } from "../redis";

// OAuth App rather than GitHub App: a GitHub App would give per-repo permission
// but needs an install flow, per-install tokens and webhooks. Recorded in
// BUILD_PLAN §10a as the upgrade.
const SESSION_COOKIE = "td_gh";
const STATE_TTL_SECONDS = 10 * 60;
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

const stateKey = (state: string) => `ghstate:${state}`;
const tokenKey = (id: string) => `gh:${id}`;

/**
 * Two scopes, because they buy different things. Signing in needs a name and an
 * id; reading private repos needs GitHub's coarse `repo`, which also grants
 * write across every repository the user owns. Asking for the second in order
 * to do the first is how products end up with permissions nobody agreed to.
 */
export const SCOPES = {
  identity: "read:user",
  repos: "read:user repo",
} as const;

export type ScopeName = keyof typeof SCOPES;

export function scopeFrom(value: string | null): ScopeName {
  return value === "repos" ? "repos" : "identity";
}

export function oauthConfigured(): boolean {
  return Boolean(process.env.GITHUB_OAUTH_CLIENT_ID && process.env.GITHUB_OAUTH_CLIENT_SECRET);
}

export async function createState(): Promise<string> {
  const state = randomBytes(16).toString("base64url");
  await redis().set(stateKey(state), 1, { ex: STATE_TTL_SECONDS });
  return state;
}

/** Single use: a state that cannot be deleted was never issued, or was replayed. */
export async function consumeState(state: string | null): Promise<boolean> {
  if (!state) return false;
  return (await redis().del(stateKey(state))) === 1;
}

/** Who the session belongs to, and what they let us do. */
export interface GhSession {
  token: string;
  scope: ScopeName;
  userId: string;
  login: string;
  avatarUrl?: string;
}

export async function storeSession(session: GhSession): Promise<string> {
  const id = randomUUID();
  await redis().set(tokenKey(id), session, { ex: TOKEN_TTL_SECONDS });
  return id;
}

async function readSession(id: string | undefined): Promise<GhSession | undefined> {
  if (!id) return undefined;
  const stored = await redis().get<GhSession | string>(tokenKey(id));
  if (!stored) return undefined;
  // Sessions created before accounts existed hold a bare token string. They
  // still open private repos; they just do not know who they belong to.
  if (typeof stored === "string") {
    return { token: stored, scope: "repos", userId: "", login: "" };
  }
  return stored;
}

export async function currentSession(): Promise<GhSession | undefined> {
  return readSession((await cookies()).get(SESSION_COOKIE)?.value);
}

/**
 * The access token never leaves the server: the cookie holds only a session id
 * and the token lives in Redis under it.
 */
export async function sessionToken(): Promise<string | undefined> {
  return (await currentSession())?.token;
}

/** Rewrites a session in place, keeping its remaining lifetime. */
export async function updateSession(id: string, session: GhSession): Promise<void> {
  const ttl = await redis().ttl(tokenKey(id));
  await redis().set(tokenKey(id), session, { ex: ttl > 0 ? ttl : TOKEN_TTL_SECONDS });
}

export async function sessionId(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function dropSession(id: string): Promise<void> {
  await redis().del(tokenKey(id));
}

export const sessionCookie = {
  name: SESSION_COOKIE,
  options: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: TOKEN_TTL_SECONDS,
  },
};

export function callbackUrl(request: Request): string {
  return new URL("/api/auth/github/callback", request.url).toString();
}
