import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { FileEntry } from "./indexer/walk";

// File-level import graph, resolved from import/require specifiers.
// Good enough for M1 blast-radius questions; M3 upgrades to a symbol-level
// reference graph via the TS compiler API (BUILD_PLAN §5 Tier 1).

const CODE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const RESOLVE_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const IMPORT_RE = /(?:import|export)\s[^'"`]*?from\s*['"`]([^'"`]+)['"`]|(?:import|require)\(\s*['"`]([^'"`]+)['"`]/g;

export interface ImportGraph {
  imports: Map<string, Set<string>>; // file → files it imports
  importedBy: Map<string, Set<string>>; // file → files that import it
}

interface Alias {
  prefix: string; // e.g. "@/"
  target: string; // e.g. "src/"
}

function loadAliases(root: string): Alias[] {
  const aliases: Alias[] = [];
  for (const cfg of ["tsconfig.json", "jsconfig.json"]) {
    const p = path.join(root, cfg);
    if (!existsSync(p)) continue;
    try {
      // tsconfig allows comments/trailing commas — strip the common cases
      const raw = readFileSync(p, "utf8")
        .replace(/\/\/[^\n"]*$/gm, "")
        .replace(/,\s*([}\]])/g, "$1");
      const json = JSON.parse(raw);
      const baseUrl: string = json.compilerOptions?.baseUrl ?? ".";
      const paths: Record<string, string[]> = json.compilerOptions?.paths ?? {};
      for (const [key, targets] of Object.entries(paths)) {
        if (!targets?.[0]) continue;
        const prefix = key.replace(/\*$/, "");
        const target = path
          .join(baseUrl, targets[0].replace(/\*$/, ""))
          .split(path.sep)
          .join("/")
          .replace(/^\.\//, "");
        aliases.push({
          prefix,
          target: target === "." || target === "" ? "" : target.replace(/\/?$/, "/"),
        });
      }
    } catch {
      // unparseable tsconfig — no aliases
    }
  }
  return aliases;
}

function resolveTo(candidates: Set<string>, base: string): string | null {
  const normalized = path.normalize(base).split(path.sep).join("/");
  if (candidates.has(normalized)) return normalized;
  for (const ext of RESOLVE_EXTS) {
    if (candidates.has(normalized + ext)) return normalized + ext;
  }
  for (const ext of RESOLVE_EXTS) {
    if (candidates.has(`${normalized}/index${ext}`)) return `${normalized}/index${ext}`;
  }
  return null;
}

export function buildImportGraph(root: string, files: FileEntry[]): ImportGraph {
  const aliases = loadAliases(root);
  const codeFiles = files.filter((f) => CODE_EXTS.has(f.ext) && f.loc > 0);
  const candidates = new Set(codeFiles.map((f) => f.path));

  const imports = new Map<string, Set<string>>();
  const importedBy = new Map<string, Set<string>>();

  for (const f of codeFiles) {
    let src = "";
    try {
      src = readFileSync(path.join(root, f.path), "utf8");
    } catch {
      continue;
    }
    let m;
    IMPORT_RE.lastIndex = 0;
    while ((m = IMPORT_RE.exec(src)) !== null) {
      const spec = (m[1] ?? m[2] ?? "").split("?")[0];
      if (!spec) continue;

      let resolved: string | null = null;
      if (spec.startsWith(".")) {
        resolved = resolveTo(candidates, path.join(path.dirname(f.path), spec));
      } else {
        const alias = aliases.find((a) => spec.startsWith(a.prefix));
        if (alias) {
          resolved = resolveTo(candidates, alias.target + spec.slice(alias.prefix.length));
        }
      }
      if (!resolved || resolved === f.path) continue;

      if (!imports.has(f.path)) imports.set(f.path, new Set());
      imports.get(f.path)!.add(resolved);
      if (!importedBy.has(resolved)) importedBy.set(resolved, new Set());
      importedBy.get(resolved)!.add(f.path);
    }
  }

  return { imports, importedBy };
}
