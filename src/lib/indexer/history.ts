import type { RepoRef } from "../github";

/**
 * Git history mining (BUILD_PLAN §5 Tier 2), opportunistic by design. A real
 * commit's diff is a free answer key: describe what the change did, ask which
 * files it touched. The thin repo is the default case, so this activates only
 * when history actually supports it and never carries the experience — every
 * failure path returns null and the session goes on without it.
 *
 * History comes from the API rather than the checkout: the indexer fetches
 * tarballs, which carry no commits.
 */

export interface MinedCommit {
  sha: string;
  subject: string;
  /** Code files the commit touched, repo-relative. */
  files: string[];
  changes: number;
  /** Trimmed unified diff, for phrasing the question. */
  patch: string;
}

const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|swift|php|cs|vue|svelte|prisma|sql)$/;
const GENERATED = /(lock|\.lock|\.min\.|\.snap$|generated|__snapshots__|dist\/|build\/|\.d\.ts$)/;
// Housekeeping commits describe nothing a developer could be asked about.
const CHORE = /^(merge|initial commit|init$|wip|bump|chore|docs?|style|format|lint|prettier|revert|update readme|version|release|deps?:)/i;

const CANDIDATES = 24;
const DETAIL_FETCHES = 4;
const MIN_FILES = 2;
const MAX_FILES = 6;
const MIN_CHANGES = 20;
const MAX_CHANGES = 800;
const PATCH_BUDGET = 6_000;

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "third-degree-indexer",
  };
  const auth = token ?? process.env.GITHUB_TOKEN;
  if (auth) h.Authorization = `Bearer ${auth}`;
  return h;
}

async function api<T>(path: string, token?: string): Promise<T | null> {
  try {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: headers(token),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null; // rate limited, private, or gone: skip quietly
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface ListedCommit {
  sha: string;
  commit: { message: string };
  parents: { sha: string }[];
}

interface CommitDetail {
  sha: string;
  commit: { message: string };
  files?: { filename: string; status: string; changes: number; patch?: string }[];
}

/**
 * Picks one commit worth asking about, or null when history does not support
 * it: a single squashed "initial commit", a repo of lockfile bumps, a
 * rate-limited API.
 */
export async function mineCommit(
  ref: RepoRef,
  sha: string | undefined,
  token?: string,
): Promise<MinedCommit | null> {
  const list = await api<ListedCommit[]>(
    `/repos/${ref.owner}/${ref.repo}/commits?per_page=${CANDIDATES}${sha ? `&sha=${sha}` : ""}`,
    token,
  );
  if (!Array.isArray(list) || list.length < 3) return null; // history too thin to mine

  const worthwhile = list.filter((c) => {
    if ((c.parents?.length ?? 0) > 1) return false; // merges describe nothing
    const subject = (c.commit?.message ?? "").split("\n")[0].trim();
    return subject.length >= 12 && subject.length <= 120 && !CHORE.test(subject);
  });

  for (const candidate of worthwhile.slice(0, DETAIL_FETCHES)) {
    const detail = await api<CommitDetail>(
      `/repos/${ref.owner}/${ref.repo}/commits/${candidate.sha}`,
      token,
    );
    const touched = (detail?.files ?? []).filter(
      (f) => CODE.test(f.filename) && !GENERATED.test(f.filename),
    );
    const changes = touched.reduce((n, f) => n + (f.changes ?? 0), 0);
    if (touched.length < MIN_FILES || touched.length > MAX_FILES) continue;
    if (changes < MIN_CHANGES || changes > MAX_CHANGES) continue;

    let patch = "";
    for (const f of touched) {
      if (!f.patch || patch.length > PATCH_BUDGET) continue;
      patch += `--- ${f.filename} (${f.status}) ---\n${f.patch.slice(0, 2_000)}\n\n`;
    }
    if (patch.length < 40) continue; // no diff to describe

    return {
      sha: candidate.sha,
      subject: (candidate.commit?.message ?? "").split("\n")[0].trim(),
      files: touched.map((f) => f.filename).sort(),
      changes,
      patch,
    };
  }
  return null;
}

/** Catches a description that gave away a path, in words or in camelCase. */
export function mentionsPath(description: string, files: string[]): boolean {
  const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const haystack = ` ${words(description.replace(/([a-z])([A-Z])/g, "$1 $2"))} `;
  for (const file of files) {
    const base = (file.split("/").pop() ?? file).replace(/\.[^.]+$/, "");
    const spaced = words(base.replace(/([a-z])([A-Z])/g, "$1 $2"));
    const parts = spaced.split(" ").filter((w) => w.length >= 6);
    // The whole basename, then any distinctive word inside it. Short generic
    // segments (api, app, ui) are skipped: they are unavoidable in prose.
    if (spaced.split(" ").length > 1 && haystack.includes(` ${spaced} `)) return true;
    if (parts.some((w) => haystack.includes(` ${w} `))) return true;
  }
  return false;
}
