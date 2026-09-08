import { createHash } from "node:crypto";

/**
 * The training/evaluation dataset for the learned question ranker. One row per
 * graded attempt, built from the product's own grill sessions - real events
 * only, nothing synthesized. Rows carry no answer text and no question prompts,
 * and session ids are hashed: the dataset is joinable within itself but not
 * back to the store.
 */

export const DATASET_VERSION = "v1";
export const DATASET_DIR = "data/ranking";
export const DATASET_FILE = `${DATASET_DIR}/${DATASET_VERSION}/attempts.jsonl`;
export const MANIFEST_FILE = `${DATASET_DIR}/manifest.json`;

export interface AttemptRow {
  v: 1;
  /** ms epoch of the session's creation. Attempts carry no clock of their own. */
  t: number;
  /** sha256 prefix of the session id. */
  session: string;
  /** owner/name. Private repos are excluded at build time. */
  repo: string;
  mode: "grill" | "learn" | "defend";
  /** Zero-based slot the current (baseline) ranker gave this question. */
  position: number;
  kind: string;
  layer: number;
  tier: number;
  /** Concept tags on the question; the fixed kind tag when the model wrote none. */
  tags: string[];
  /** Concepts the review queue asked to resurface when the session started. */
  due: string[];
  score: number | null;
  hints: number;
  latencyMs: number;
  /**
   * The label: hinted, or scored under the pass mark. Null when grading was
   * unavailable - such rows count as history but never as labels.
   */
  missed: boolean | null;
  /** The session reached its verdict screen. */
  finished: boolean;
  /** How many questions the session held, attempted or not. */
  nq: number;
}

export interface Manifest {
  datasetVersion: string;
  file: string;
  sha256: string;
  rows: number;
  labeledRows: number;
  sessions: number;
  repos: Record<string, number>;
  timeRange: { from: string; to: string };
  splits: {
    /**
     * Primary split: evaluation unit is the session (the product's users are
     * anonymous, so a session is the closest thing to a user id it has). Every
     * training session starts strictly before this instant, every evaluation
     * session at or after it.
     */
    primaryCutoff: string;
    /** Repo-holdout slice: these repos are never trained on. */
    evalRepos: string[];
  };
  provenance: string;
}

export function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

export function hashSessionId(id: string): string {
  return sha256Hex(id).slice(0, 12);
}

function isRow(value: unknown): value is AttemptRow {
  const r = value as AttemptRow;
  return (
    r?.v === 1 &&
    typeof r.t === "number" &&
    typeof r.session === "string" &&
    typeof r.repo === "string" &&
    typeof r.position === "number" &&
    typeof r.kind === "string" &&
    typeof r.layer === "number" &&
    Array.isArray(r.tags) &&
    Array.isArray(r.due) &&
    (typeof r.missed === "boolean" || r.missed === null)
  );
}

export function serializeRows(rows: AttemptRow[]): string {
  return rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

export function parseRows(jsonl: string): AttemptRow[] {
  const rows: AttemptRow[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    const parsed: unknown = JSON.parse(line);
    if (!isRow(parsed)) throw new Error(`Malformed dataset row: ${line.slice(0, 120)}`);
    rows.push(parsed);
  }
  return rows;
}

/** Stable order: by session start, then session, then the baseline's slot. */
export function sortRows(rows: AttemptRow[]): AttemptRow[] {
  return [...rows].sort(
    (a, b) => a.t - b.t || a.session.localeCompare(b.session) || a.position - b.position,
  );
}
