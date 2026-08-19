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

// GitHub's OAuth scopes are coarse: reading private repos requires `repo`,
// which also grants write. Mitigated by never asking unless the user clicks
// Connect, and by keeping paste-a-URL as the default path.
export const GITHUB_SCOPE = "repo";

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

export async function storeToken(token: string): Promise<string> {
  const id = randomUUID();
  await redis().set(tokenKey(id), token, { ex: TOKEN_TTL_SECONDS });
  return id;
}

/**
 * The access token never leaves the server: the cookie holds only a session id
 * and the token lives in Redis under it.
 */
export async function sessionToken(): Promise<string | undefined> {
  const id = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!id) return undefined;
  return (await redis().get<string>(tokenKey(id))) ?? undefined;
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
