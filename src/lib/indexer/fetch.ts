import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { x } from "tar";
import type { RepoRef } from "../github";

// os.tmpdir() is the only writable path in a serverless function, and there is
// no `git` binary there — so we take GitHub's tarball instead of cloning. It's
// also faster: one HTTP request, no history (BUILD_PLAN §9's blob-less intent).
const REPOS_DIR = path.join(os.tmpdir(), "third-degree-repos");

export function repoDir(ref: RepoRef, sha?: string): string {
  return path.join(REPOS_DIR, `${ref.owner}__${ref.repo}${sha ? `__${sha}` : ""}`);
}

export interface FetchedRepo {
  root: string;
  /** The commit the tree came from, read off the tarball's root directory. */
  sha: string | null;
}

/**
 * Downloads a repo at a specific commit when one is known.
 *
 * Pinning matters because the map and the questions are built at different
 * times: the map is indexed once, and a grill can be started from it minutes or
 * days later. Without a pin, the grill re-walked whatever HEAD had become and
 * generated questions against a tree the map never saw, which on a repo that
 * had moved on could leave too few questions to run at all. Caching by name
 * alone made it worse on warm instances, which happily reused another commit's
 * tree (BUILD_PLAN §9: cache per SHA).
 */
export async function fetchRepo(
  ref: RepoRef,
  userToken?: string,
  pinnedSha?: string,
): Promise<FetchedRepo> {
  // Already have this exact commit on this instance: nothing to download.
  if (pinnedSha) {
    const pinned = repoDir(ref, pinnedSha);
    if (existsSync(pinned)) return { root: pinned, sha: pinnedSha };
  }

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "third-degree-indexer",
  };
  const token = userToken ?? process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(
      `https://api.github.com/repos/${ref.owner}/${ref.repo}/tarball${pinnedSha ? `/${pinnedSha}` : ""}`,
      { headers, signal: AbortSignal.timeout(120_000) },
    );
  } catch (err) {
    throw new Error(
      err instanceof Error && err.name === "TimeoutError"
        ? "Downloading this repo took too long. It may be too large or GitHub may be slow."
        : "Couldn't download the repo from GitHub. Try again in a moment.",
    );
  }
  if (res.status === 404 && pinnedSha) {
    // Force-pushed, rebased, or a deleted branch: the indexed commit is gone.
    throw new Error(
      "The commit this map was built from is no longer on GitHub. Map the repo again to index the current code.",
    );
  }
  if (!res.ok || !res.body) {
    throw new Error(`Couldn't download the repo from GitHub (${res.status}).`);
  }

  // Extract to a scratch dir, then rename into place, so two requests indexing
  // the same repo can't interleave writes into a half-built tree.
  mkdirSync(REPOS_DIR, { recursive: true });
  const scratch = path.join(REPOS_DIR, `${ref.owner}__${ref.repo}.${randomBytes(4).toString("hex")}.tmp`);
  mkdirSync(scratch, { recursive: true });
  let sha: string | null = pinnedSha ?? null;
  try {
    await pipeline(
      Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
      // GitHub wraps everything in an `owner-repo-sha/` directory. `strip: 1`
      // drops it, so read the commit off the first entry before it goes.
      x({
        cwd: scratch,
        strip: 1,
        onReadEntry: (entry) => {
          if (sha) return;
          const root = String(entry.path).split("/")[0] ?? "";
          sha = /-([0-9a-f]{7,40})$/.exec(root)?.[1] ?? null;
        },
      }),
    );
    const dest = repoDir(ref, sha ?? undefined);
    if (existsSync(dest)) {
      rmSync(scratch, { recursive: true, force: true });
    } else {
      renameSync(scratch, dest);
    }
    return { root: dest, sha };
  } catch (err) {
    rmSync(scratch, { recursive: true, force: true });
    throw err;
  }
}
