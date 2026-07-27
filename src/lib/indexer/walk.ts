import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { LanguageStat } from "../types";

export interface FileEntry {
  path: string; // repo-relative, forward slashes
  ext: string;
  loc: number;
}

const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "out", "coverage",
  ".turbo", ".vercel", "vendor", "__pycache__", ".venv", "venv",
  ".cache", ".idea", ".vscode", "target",
]);

const LANGUAGE_BY_EXT: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".mts": "TypeScript", ".cts": "TypeScript",
  ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
  ".py": "Python", ".rb": "Ruby", ".go": "Go", ".rs": "Rust", ".java": "Java",
  ".kt": "Kotlin", ".swift": "Swift", ".c": "C", ".h": "C", ".cpp": "C++",
  ".cc": "C++", ".hpp": "C++", ".cs": "C#", ".php": "PHP",
  ".css": "CSS", ".scss": "CSS", ".html": "HTML", ".vue": "Vue", ".svelte": "Svelte",
  ".sql": "SQL", ".prisma": "Prisma", ".sh": "Shell", ".yml": "YAML", ".yaml": "YAML",
  ".json": "JSON", ".md": "Markdown", ".mdx": "Markdown",
};

const COUNTED_FOR_LOC = new Set(Object.keys(LANGUAGE_BY_EXT));
const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 1_000_000;

export function walkRepo(root: string): { files: FileEntry[]; languages: LanguageStat[] } {
  const files: FileEntry[] = [];

  const visit = (dir: string) => {
    if (files.length >= MAX_FILES) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      if (entry.name.startsWith(".") && entry.name !== ".github" && entry.name !== ".env.example") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        visit(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        let loc = 0;
        if (COUNTED_FOR_LOC.has(ext)) {
          try {
            const stat = statSync(full);
            if (stat.size <= MAX_FILE_BYTES) {
              loc = readFileSync(full, "utf8").split("\n").length;
            }
          } catch {
            // unreadable file — skip LOC
          }
        }
        files.push({
          path: path.relative(root, full).split(path.sep).join("/"),
          ext,
          loc,
        });
      }
    }
  };
  visit(root);

  const byLang = new Map<string, { files: number; loc: number }>();
  for (const f of files) {
    const lang = LANGUAGE_BY_EXT[f.ext];
    if (!lang || lang === "JSON" || lang === "Markdown" || lang === "YAML") continue;
    const cur = byLang.get(lang) ?? { files: 0, loc: 0 };
    cur.files += 1;
    cur.loc += f.loc;
    byLang.set(lang, cur);
  }
  const totalLoc = [...byLang.values()].reduce((s, v) => s + v.loc, 0) || 1;
  const languages: LanguageStat[] = [...byLang.entries()]
    .map(([name, v]) => ({ name, files: v.files, loc: v.loc, pct: Math.round((v.loc / totalLoc) * 100) }))
    .sort((a, b) => b.loc - a.loc)
    .slice(0, 8);

  return { files, languages };
}
