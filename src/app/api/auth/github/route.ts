import { NextResponse } from "next/server";
import {
  GITHUB_SCOPE,
  callbackUrl,
  createState,
  dropSession,
  oauthConfigured,
  sessionCookie,
  sessionId,
} from "@/lib/auth/github";

export async function GET(request: Request) {
  if (!oauthConfigured()) {
    return NextResponse.redirect(new URL("/?gh=unavailable", request.url));
  }
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_OAUTH_CLIENT_ID!,
    redirect_uri: callbackUrl(request),
    scope: GITHUB_SCOPE,
    state: await createState(),
  });
  return NextResponse.redirect(`https://github.com/login/oauth/authorize?${params}`);
}

// Disconnecting has to drop the token, not just the cookie.
export async function DELETE() {
  const id = await sessionId();
  if (id) await dropSession(id);
  const res = NextResponse.json({ connected: false });
  res.cookies.set(sessionCookie.name, "", { ...sessionCookie.options, maxAge: 0 });
  return res;
}
