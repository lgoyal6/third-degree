import { NextResponse } from "next/server";
import { oauthConfigured, sessionToken } from "@/lib/auth/github";

export interface RepoChoice {
  fullName: string;
  private: boolean;
  language: string | null;
  pushedAt: string | null;
}

export async function GET() {
  const token = await sessionToken();
  if (!token) {
    // `available` tells the client whether to offer Connect at all, so an
    // unconfigured deployment shows no dead button.
    return NextResponse.json(
      { error: "Not connected.", available: oauthConfigured() },
      { status: 401 },
    );
  }

  const res = await fetch(
    "https://api.github.com/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member",
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "third-degree-indexer",
      },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (res.status === 401) {
    return NextResponse.json({ error: "GitHub connection expired.", available: true }, { status: 401 });
  }
  if (!res.ok) {
    return NextResponse.json({ error: `GitHub API error (${res.status}).` }, { status: 502 });
  }

  const repos = (await res.json()) as {
    full_name: string;
    private: boolean;
    language: string | null;
    pushed_at: string | null;
  }[];
  return NextResponse.json({
    repos: repos.map((r) => ({
      fullName: r.full_name,
      private: r.private,
      language: r.language,
      pushedAt: r.pushed_at,
    })),
  });
}
