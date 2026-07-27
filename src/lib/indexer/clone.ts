import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { RepoRef } from "../github";

const execFileAsync = promisify(execFile);

const REPOS_DIR = path.join(process.cwd(), ".repos");

// Shallow clone — M0's map needs file contents, not history. History-dependent
// features (commit-depth readiness, git mining) come later and will use
// --filter=blob:none separately.
export async function cloneRepo(ref: RepoRef): Promise<string> {
  mkdirSync(REPOS_DIR, { recursive: true });
  const dest = path.join(REPOS_DIR, `${ref.owner}__${ref.repo}`);
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });

  await execFileAsync(
    "git",
    ["clone", "--depth=1", "--single-branch", `https://github.com/${ref.owner}/${ref.repo}.git`, dest],
    {
      timeout: 120_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    },
  );
  return dest;
}
