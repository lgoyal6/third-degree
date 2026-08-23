import path from "node:path";
import { existsSync } from "node:fs";
import { Node, Project, type SourceFile } from "ts-morph";
import type { FileEntry } from "./walk";

/**
 * Symbol-level reference graph (BUILD_PLAN §5 Tier 1). The import graph next
 * door answers "which files pull in this module"; this answers "which files use
 * this function", which is the question an interviewer actually asks and the
 * one a rename actually breaks. Real resolution comes from the TypeScript
 * language service, never from a regex and never from a model.
 */

export interface SymbolRef {
  name: string;
  kind: "function" | "class" | "value";
  /** Where it is declared, repo-relative. */
  file: string;
  line: number;
  /** Distinct files that reference it, excluding its own. */
  files: string[];
  /** Reference sites outside the declaring file. */
  refs: number;
}

const CODE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);
// Above this the graph would be built from a truncated file set, and a blast
// radius that quietly omits callers is worse than no question at all.
const MAX_PROJECT_FILES = 1_200;
const MAX_CANDIDATES = 80;
const BUDGET_MS = 25_000;

function isCode(f: FileEntry): boolean {
  return (
    CODE_EXTS.has(f.ext) &&
    !f.path.endsWith(".d.ts") &&
    !/(^|\/)(node_modules|dist|build|out|coverage)\//.test(f.path)
  );
}

/** The name node is where the language service finds references from. */
function nameNodeOf(decl: Node): Node | undefined {
  if (Node.isFunctionDeclaration(decl) || Node.isClassDeclaration(decl)) {
    return decl.getNameNode();
  }
  if (Node.isVariableDeclaration(decl)) return decl.getNameNode();
  return undefined;
}

function kindOf(decl: Node): SymbolRef["kind"] | null {
  if (Node.isFunctionDeclaration(decl)) return "function";
  if (Node.isClassDeclaration(decl)) return "class";
  if (Node.isVariableDeclaration(decl)) {
    const init = decl.getInitializer();
    if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) return "function";
    return "value";
  }
  // Types and interfaces are skipped: "which files call this type" is not a
  // question, and their breakage shows up through the values that use them.
  return null;
}

/** A parsed repo, shared by everything that needs the language service. */
export interface RepoProject {
  project: Project;
  sources: SourceFile[];
  /** Absolute path back to the repo-relative one. */
  rel: (abs: string) => string;
}

export function openProject(root: string, files: FileEntry[]): RepoProject | null {
  const code = files.filter(isCode);
  if (code.length === 0 || code.length > MAX_PROJECT_FILES) return null;

  const tsconfig = ["tsconfig.json", "jsconfig.json"]
    .map((f) => path.join(root, f))
    .find((p) => existsSync(p));

  let project: Project;
  try {
    project = new Project({
      // The repo's own compilerOptions, so its path aliases resolve the way it
      // resolves them. Its file list is ignored in favour of the walked set.
      ...(tsconfig ? { tsConfigFilePath: tsconfig } : {}),
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      compilerOptions: { allowJs: true, skipLibCheck: true, noEmit: true },
    });
  } catch {
    return null; // unreadable tsconfig
  }

  const sources: SourceFile[] = [];
  for (const f of code) {
    try {
      sources.push(project.addSourceFileAtPath(path.join(root, f.path)));
    } catch {
      // unreadable or unparseable file: it simply is not in the graph
    }
  }
  if (sources.length === 0) return null;

  return {
    project,
    sources,
    rel: (abs: string) => path.relative(root, abs).split(path.sep).join("/"),
  };
}

export function buildSymbolGraph(
  root: string,
  files: FileEntry[],
  opened?: RepoProject | null,
): SymbolRef[] {
  const repo = opened === undefined ? openProject(root, files) : opened;
  if (!repo) return [];
  const { project, sources, rel } = repo;
  const service = project.getLanguageService();
  const started = Date.now();
  const out: SymbolRef[] = [];
  let examined = 0;

  // Declaration files worth asking about first: the shared internals a rename
  // ripples out of, rather than a leaf component nobody imports.
  const ranked = [...sources].sort((a, b) => score(rel(b.getFilePath())) - score(rel(a.getFilePath())));

  for (const source of ranked) {
    if (examined >= MAX_CANDIDATES || Date.now() - started > BUDGET_MS) break;
    const declFile = rel(source.getFilePath());
    let exported: ReadonlyMap<string, Node[]>;
    try {
      exported = source.getExportedDeclarations();
    } catch {
      continue;
    }

    for (const [name, decls] of exported) {
      if (examined >= MAX_CANDIDATES || Date.now() - started > BUDGET_MS) break;
      if (name === "default" || name.length < 4) continue;
      const decl = decls[0];
      if (!decl) continue;
      const kind = kindOf(decl);
      const nameNode = kind ? nameNodeOf(decl) : undefined;
      if (!kind || !nameNode) continue;
      // Re-exports: the declaration lives elsewhere, so let its own file own it.
      if (rel(decl.getSourceFile().getFilePath()) !== declFile) continue;

      examined += 1;
      let sites: Node[];
      try {
        sites = service.findReferencesAsNodes(nameNode);
      } catch {
        continue;
      }

      const byFile = new Map<string, number>();
      for (const site of sites) {
        const file = rel(site.getSourceFile().getFilePath());
        if (file === declFile || file.startsWith("..") || file.endsWith(".d.ts")) continue;
        byFile.set(file, (byFile.get(file) ?? 0) + 1);
      }
      if (byFile.size === 0) continue;

      out.push({
        name,
        kind,
        file: declFile,
        line: decl.getStartLineNumber(),
        files: [...byFile.keys()].sort(),
        refs: [...byFile.values()].reduce((s, n) => s + n, 0),
      });
    }
  }

  return out;
}

/** Shared internals over leaves: a rename in lib/db hurts more than one in a page. */
function score(file: string): number {
  let n = 0;
  if (/(^|\/)(lib|server|db|core|services|utils|hooks|api|auth)\//.test(file)) n += 3;
  if (/\/(queries|client|schema|actions|helpers|index)\.[tj]sx?$/.test(file)) n += 2;
  if (/\.(test|spec|stories)\./.test(file)) n -= 4;
  if (/(^|\/)(components|app|pages)\//.test(file)) n -= 1;
  return n;
}
