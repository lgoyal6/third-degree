import { NextResponse } from "next/server";
import {
  callbackUrl,
  consumeState,
  oauthConfigured,
  sessionCookie,
  storeToken,
} from "@/lib/auth/github";

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
  if (!(await consumeState(params.get("state")))) return home(request, "state");

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
    const data = (await res.json()) as { access_token?: string };
    token = data.access_token;
  } catch {
    return home(request, "failed");
  }
  if (!token) return home(request, "failed");

  const id = await storeToken(token);
  const res = home(request, "connected");
  res.cookies.set(sessionCookie.name, id, sessionCookie.options);
  return res;
}
