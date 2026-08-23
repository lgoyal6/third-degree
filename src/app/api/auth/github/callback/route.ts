import { NextResponse } from "next/server";
import {
  callbackUrl,
  consumeState,
  oauthConfigured,
  scopeFrom,
  sessionCookie,
  storeSession,
} from "@/lib/auth/github";
import { rememberUser } from "@/lib/account/store";

function home(request: Request, status: string) {
  return NextResponse.redirect(new URL(`/?gh=${status}`, request.url));
}

export async function GET(request: Request) {
  if (!oauthConfigured()) return home(request, "unavailable");

  const params = new URL(request.url).searchParams;
  // The user pressed Cancel on the consent screen.
  if (params.get("error")) return home(request, "denied");

  const code = params.get("code");
  if (!code) return home(request, "failed");
  // "<scope>.<nonce>": the nonce is what is single-use, the prefix only says
  // which flow started it.
  const [scopeHint, ...rest] = (params.get("state") ?? "").split(".");
  const scope = scopeFrom(scopeHint);
  if (!(await consumeState(rest.join(".") || null))) return home(request, "state");

  let token: string | undefined;
  try {
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.GITHUB_OAUTH_CLIENT_ID,
        client_secret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
        code,
        redirect_uri: callbackUrl(request),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
    // GitHub answers 200 with an error body, and the distinction matters when
    // debugging a setup: incorrect_client_credentials means the id/secret pair
    // is wrong, redirect_uri_mismatch means the app's callback does not match.
    if (data.error) {
      console.error("[gh-oauth] exchange rejected:", data.error, data.error_description ?? "");
    }
    token = data.access_token;
  } catch (err) {
    console.error("[gh-oauth] exchange failed:", err instanceof Error ? err.message : err);
    return home(request, "failed");
  }
  if (!token) return home(request, "failed");

  // Who they are, once, at sign-in: the account is keyed by GitHub's own id
  // rather than the login, which people change.
  let account: { id: number; login: string; avatar_url?: string } | undefined;
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "third-degree-indexer",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) account = await res.json();
  } catch (err) {
    console.error("[gh-oauth] user lookup failed:", err instanceof Error ? err.message : err);
  }
  if (!account?.id) return home(request, "failed");

  await rememberUser({
    id: String(account.id),
    login: account.login,
    avatarUrl: account.avatar_url,
  });
  const id = await storeSession({
    token,
    scope,
    userId: String(account.id),
    login: account.login,
    avatarUrl: account.avatar_url,
  });
  const res = home(request, scope === "repos" ? "connected" : "signedin");
  res.cookies.set(sessionCookie.name, id, sessionCookie.options);
  return res;
}
