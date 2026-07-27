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

export async function fetchRepoMeta(ref: RepoRef): Promise<RepoMeta> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "third-degree-indexer",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const res = await fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) throw new Error("Repo not found — is it public?");
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
    description: data.description ?? null,
    defaultBranch: data.default_branch ?? "main",
    stars: data.stargazers_count ?? 0,
    sizeKB: data.size ?? 0,
    pushedAt: data.pushed_at ?? null,
  };
}
