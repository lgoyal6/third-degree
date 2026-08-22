import type { RepoMeta } from "./types";

// 150 MB cap — abuse control, see BUILD_PLAN §9
const MAX_REPO_SIZE_KB = 150_000;

export interface RepoRef {
  owner: string;
  repo: string;
}

// Accepts "owner/repo", "github.com/owner/repo", full https URLs with or
// without .git, and trailing paths (/tree/main etc.).
export function parseRepoUrl(input: string): RepoRef | null {
  const trimmed = input.trim().replace(/\.git$/, "");
  const shorthand = /^([\w.-]+)\/([\w.-]+)$/.exec(trimmed);
  if (shorthand && !trimmed.includes(".com")) {
    return { owner: shorthand[1], repo: shorthand[2] };
  }
  const url = /github\.com[/:]([\w.-]+)\/([\w.-]+)/.exec(trimmed);
  if (url) return { owner: url[1], repo: url[2] };
  return null;
}

export async function fetchRepoMeta(ref: RepoRef, userToken?: string): Promise<RepoMeta> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "third-degree-indexer",
  };
  // The connected user's token first: it is what makes private repos visible.
  const token = userToken ?? process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}`, {
      headers,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    // Without this, an aborted fetch surfaces the raw "The operation was
    // aborted due to timeout" to the user.
    throw new Error(
      err instanceof Error && err.name === "TimeoutError"
        ? "GitHub took too long to respond. Try again in a moment."
        : "Couldn't reach GitHub. Check the URL and try again.",
    );
  }
  if (res.status === 404) {
    throw new Error(
      userToken
        ? "Repo not found — check the name, and that your GitHub connection can see it."
        : "Repo not found — is it public? Connect GitHub to reach private repos.",
    );
  }
  if (res.status === 403 || res.status === 429) {
    throw new Error("GitHub rate limit hit — try again in a minute (or set GITHUB_TOKEN).");
  }
  if (!res.ok) throw new Error(`GitHub API error (${res.status})`);
  const data = await res.json();
  if (data.size > MAX_REPO_SIZE_KB) {
    throw new Error(`Repo is ${Math.round(data.size / 1024)} MB — the cap is ${MAX_REPO_SIZE_KB / 1000} MB for now.`);
  }
  return {
    owner: ref.owner,
    name: data.name,
    private: Boolean(data.private),
    description: data.description ?? null,
    defaultBranch: data.default_branch ?? "main",
    stars: data.stargazers_count ?? 0,
    sizeKB: data.size ?? 0,
    pushedAt: data.pushed_at ?? null,
  };
}
