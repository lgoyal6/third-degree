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

export function repoDir(ref: RepoRef): string {
  return path.join(REPOS_DIR, `${ref.owner}__${ref.repo}`);
}

export async function fetchRepo(ref: RepoRef): Promise<string> {
  const dest = repoDir(ref);
  // Same instance already has it (map → grill on a warm function): reuse.
  if (existsSync(dest)) return dest;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "third-degree-indexer",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  let res: Response;
  try {
    res = await fetch(
      `https://api.github.com/repos/${ref.owner}/${ref.repo}/tarball`,
      { headers, signal: AbortSignal.timeout(120_000) },
    );
  } catch (err) {
    throw new Error(
      err instanceof Error && err.name === "TimeoutError"
        ? "Downloading this repo took too long. It may be too large or GitHub may be slow."
        : "Couldn't download the repo from GitHub. Try again in a moment.",
    );
  }
  if (!res.ok || !res.body) {
    throw new Error(`Couldn't download the repo from GitHub (${res.status}).`);
  }

  // Extract to a scratch dir, then rename into place, so two requests indexing
  // the same repo can't interleave writes into a half-built tree.
  mkdirSync(REPOS_DIR, { recursive: true });
  const scratch = `${dest}.${randomBytes(4).toString("hex")}.tmp`;
  mkdirSync(scratch, { recursive: true });
  try {
    await pipeline(
      Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
      // GitHub wraps everything in an `owner-repo-sha/` directory.
      x({ cwd: scratch, strip: 1 }),
    );
    if (existsSync(dest)) {
      rmSync(scratch, { recursive: true, force: true });
    } else {
      renameSync(scratch, dest);
    }
  } catch (err) {
    rmSync(scratch, { recursive: true, force: true });
    throw err;
  }
  return dest;
}
