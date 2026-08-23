export type Stage =
  | "queued"
  | "meta"
  | "clone"
  | "files"
  | "stack"
  | "structure"
  | "schema"
  | "summary"
  | "done"
  | "error";

export const STAGE_ORDER: Stage[] = [
  "queued",
  "meta",
  "clone",
  "files",
  "stack",
  "structure",
  "schema",
  "summary",
  "done",
];

export interface RepoMeta {
  owner: string;
  name: string;
  private: boolean;
  description: string | null;
  defaultBranch: string;
  stars: number;
  sizeKB: number;
  pushedAt: string | null;
}

export interface LanguageStat {
  name: string;
  files: number;
  loc: number;
  pct: number;
}

export interface RouteInfo {
  kind: "page" | "api" | "middleware";
  method: string; // "GET" | "POST" | ... | "*" for pages
  path: string;
  file: string;
}

export interface ModelField {
  name: string;
  type: string;
}

export interface ModelInfo {
  name: string;
  fields: ModelField[];
  source: "prisma" | "drizzle" | "sql" | "mongoose";
  file: string;
}

export interface CategoryNode {
  name: string;
  files: number;
  loc: number;
  children: CategoryNode[];
  sampleFiles: string[];
}

export interface StackInfo {
  frameworks: string[];
  packageManager: string | null;
  dependencies: number;
  scripts: Record<string, string>;
}

export interface MapSummary {
  text: string;
  structure: string; // how the code is organized and how the pieces connect
  startHere: { file: string; reason: string };
  generatedBy: "claude" | "fallback";
}

export interface DepNode {
  id: string; // repo-relative file path
  cat: "Frontend" | "Backend" | "Data" | "Infra";
  loc: number;
  deg: number; // in + out degree
}

export interface DepEdge {
  s: string; // importer
  t: string; // imported
}

export interface LessonCard {
  using: string; // the choice as shipped: "Drizzle ORM", "App Router"
  insteadOf?: string; // omitted on the deterministic fallback card
  whyItFits: string;
  whatItCosts?: string; // omitted on the deterministic fallback card
  evidence: string[]; // repo-relative paths that exist in the map
}

/** §8's CraftItem: one concrete upgrade, shown as a diff against their code. */
export interface CraftItem {
  category: "ui" | "accessibility" | "states" | "hardening";
  file: string;
  /** Where `before` was found in the file, so the diff can be located. */
  startLine: number;
  before: string;
  after: string;
  rationale: string;
}

export interface CodeMap {
  meta?: RepoMeta;
  sha?: string; // the commit this map was built from (BUILD_PLAN §8)
  languages?: LanguageStat[];
  totalFiles?: number;
  filePaths?: string[]; // every walked path, for Layer 4 phantom detection
  totalLoc?: number;
  stack?: StackInfo;
  entryPoints?: string[];
  routes?: RouteInfo[];
  models?: ModelInfo[];
  categories?: CategoryNode[];
  graph?: { nodes: DepNode[]; edges: DepEdge[] };
  summary?: MapSummary;
  lessons?: LessonCard[];
  craft?: CraftItem[];
  /** Commits on the default branch, when the API would say (§7's shelf). */
  commitDepth?: number | null;
}

export interface MapJob {
  id: string;
  url: string;
  stage: Stage;
  error?: string;
  map: CodeMap;
  createdAt: number;
  updatedAt: number;
}
