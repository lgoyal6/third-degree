import { Node, SyntaxKind } from "ts-morph";
import type { RepoProject } from "./symbols";

/**
 * Layer 4 material (BUILD_PLAN §3): scale pressure applied to their real code.
 * A question like "10k users, here's your feed query, go" is only worth asking
 * if the query is really theirs and really shaped that way, so the hot paths
 * are found in the AST rather than guessed at by a model.
 */

export type HotspotKind = "await-in-loop" | "unbounded-query";

export interface Hotspot {
  kind: HotspotKind;
  file: string;
  /** The offending line, in the file's own numbering. */
  line: number;
  /** Enclosing function, and where it starts, for the snippet. */
  fnName: string;
  fnStartLine: number;
  /** What a grounded answer would have to name. */
  symbols: string[];
}

const LOOPS = new Set<SyntaxKind>([
  SyntaxKind.ForStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
]);

const FUNCTIONS = new Set<SyntaxKind>([
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.FunctionExpression,
  SyntaxKind.ArrowFunction,
  SyntaxKind.MethodDeclaration,
]);

// Reads that return everything unless told otherwise. `select` and `find` are
// only reads when something database-shaped is on the left of them: the first
// version of this flagged every Array.prototype.find in the repo.
const ALWAYS_READ = new Set(["findMany", "findAll", "scan"]);
const READ_WITH_DB_RECEIVER = new Set(["select", "find", "findOne"]);
const DB_RECEIVER =
  /\b(db|database|prisma|supabase|sql|knex|mongo|mongoose|collection|repository|repo|conn|pool|client|query|table|store)\b/i;
const BOUNDED = /\b(limit|take|first|findFirst|findUnique|single|maybeSingle|count|paginate|cursor)\b/i;
// A read filtered on its own primary key returns one row however big the table
// gets, so it is not scale pressure however unbounded it looks.
const POINT_LOOKUP = /eq\(\s*\w+\.id\s*,|where:\s*\{\s*id\b|\.eq\(\s*["']id["']/;
// A read inside a write is usually a guard, and the write is the story.
const WRITE_FN = /^(delete|update|insert|save|create|set|vote|upsert|remove|patch)/i;
const SKIP_FILE = /\.(test|spec|stories)\.|(^|\/)(scripts|migrations|seed)/;
const MAX = 6;

function enclosingFunction(node: Node): { name: string; startLine: number } | null {
  for (let cur = node.getParent(); cur; cur = cur.getParent()) {
    if (!FUNCTIONS.has(cur.getKind())) continue;
    const named = Node.isFunctionDeclaration(cur) || Node.isMethodDeclaration(cur) ? cur.getName() : undefined;
    if (named) return { name: named, startLine: cur.getStartLineNumber() };
    // Arrow functions and function expressions borrow the name they are
    // assigned to, which is how the repo itself refers to them.
    const decl = cur.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
    return {
      name: decl?.getName() ?? "this function",
      startLine: (decl ?? cur).getStartLineNumber(),
    };
  }
  return null;
}

/** True when a loop sits between this node and the function containing it. */
function insideLoop(node: Node): boolean {
  for (let cur = node.getParent(); cur; cur = cur.getParent()) {
    if (LOOPS.has(cur.getKind())) return true;
    if (FUNCTIONS.has(cur.getKind())) return false;
  }
  return false;
}

export function findHotspots(repo: RepoProject | null, modelNames: string[] = []): Hotspot[] {
  if (!repo) return [];
  // Mongoose-style reads sit on a model: `Chat.find({})`. The map already
  // proved which names are models, so no guessing about capitalisation.
  const isModel = (callee: string) =>
    modelNames.some((m) => m.length > 2 && new RegExp(`\\b${m}\\b`).test(callee));
  const out: Hotspot[] = [];

  for (const source of repo.sources) {
    if (out.length >= MAX) break;
    const file = repo.rel(source.getFilePath());
    if (SKIP_FILE.test(file)) continue;

    // A round trip per row: the loop is the problem, not the await.
    for (const await_ of source.getDescendantsOfKind(SyntaxKind.AwaitExpression)) {
      if (out.length >= MAX) break;
      if (!insideLoop(await_)) continue;
      const fn = enclosingFunction(await_);
      if (!fn) continue;
      const call = await_.getExpression();
      out.push({
        kind: "await-in-loop",
        file,
        line: await_.getStartLineNumber(),
        fnName: fn.name,
        fnStartLine: fn.startLine,
        symbols: [fn.name, ...callNames(call)],
      });
    }

    // A read with no bound: fine at forty rows, fatal at two million.
    for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (out.length >= MAX) break;
      const callee = call.getExpression().getText();
      const method = callee.split(".").pop() ?? "";
      const isRead =
        ALWAYS_READ.has(method) ||
        (READ_WITH_DB_RECEIVER.has(method) && (DB_RECEIVER.test(callee) || isModel(callee)));
      if (!isRead) continue;
      const statement = call.getFirstAncestorByKind(SyntaxKind.VariableStatement) ?? call.getFirstAncestorByKind(SyntaxKind.ReturnStatement);
      const text = (statement ?? call).getText();
      if (BOUNDED.test(text) || POINT_LOOKUP.test(text)) continue;
      const fn = enclosingFunction(call);
      if (!fn || WRITE_FN.test(fn.name)) continue;
      out.push({
        kind: "unbounded-query",
        file,
        line: call.getStartLineNumber(),
        fnName: fn.name,
        fnStartLine: fn.startLine,
        // From the whole chain, not just the call: the table and the column
        // being filtered are what a grounded answer names.
        symbols: [fn.name, ...callNames(statement ?? call)],
      });
    }
  }

  // Shared data access first: pressure on lib/db is pressure on every route
  // that touches it, and a loop is more visceral than an unbounded read.
  return out
    .sort((a, b) => rank(b) - rank(a))
    .filter((h, i, all) => all.findIndex((o) => o.file === h.file && o.fnName === h.fnName) === i);
}

// Query plumbing that every such statement contains, so naming it proves
// nothing about having read this one.
const PLUMBING =
  /^(await|const|let|return|this|new|async|try|catch|throw|db|database|select|from|where|and|or|eq|ne|asc|desc|orderBy|innerJoin|leftJoin|values|set|prisma|client|then|data|error|rows|result)$/i;

function callNames(node: Node): string[] {
  const text = node.getText().replace(/\s+/g, " ").slice(0, 400);
  return [...new Set(text.match(/[A-Za-z_$][A-Za-z0-9_$]{2,}/g) ?? [])]
    .filter((t) => !PLUMBING.test(t))
    .slice(0, 4);
}

function rank(h: Hotspot): number {
  let n = h.kind === "await-in-loop" ? 6 : 3;
  // A read of a collection by foreign key grows without bound; a lookup of one
  // row by a unique column mostly does not.
  if (/s(By|For)|List|All/.test(h.fnName)) n += 3;
  if (/(^|\/)(lib|server|db|services|api)\//.test(h.file)) n += 4;
  if (/(^|\/)(app|pages)\//.test(h.file)) n += 2;
  if (h.fnName === "this function") n -= 2;
  return n;
}
