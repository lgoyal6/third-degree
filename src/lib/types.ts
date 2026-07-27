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
  startHere: { file: string; reason: string };
  generatedBy: "claude" | "fallback";
}

export interface CodeMap {
  meta?: RepoMeta;
  languages?: LanguageStat[];
  totalFiles?: number;
  totalLoc?: number;
  stack?: StackInfo;
  entryPoints?: string[];
  routes?: RouteInfo[];
  models?: ModelInfo[];
  categories?: CategoryNode[];
  summary?: MapSummary;
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
