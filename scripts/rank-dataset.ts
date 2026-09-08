/**
 * Builds the versioned ranking dataset from the product's own grill sessions.
 *
 * Real, consented product events only: every row is an attempt a person made in
 * a session the product stored. Nothing is synthesized. Privacy: answer text
 * and question prompts never enter the dataset, session ids are hashed, and
 * private repos are excluded entirely.
 *
 * Usage: KV_REST_API_URL and a KV token in the environment, then
 *   npm run rank:dataset
 *
 * Writes data/ranking/v1/attempts.jsonl (gitignored - it is user data) and
 * data/ranking/manifest.json (committed - version, hash, counts, split spec).
 * The eval harness refuses to run when the local dataset's hash does not match
 * the manifest.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { KIND_TAGS } from "../src/lib/learn/tags";
import { PASS_MARK, type GrillSession } from "../src/lib/grill/types";
import {
  DATASET_FILE,
  DATASET_VERSION,
  MANIFEST_FILE,
  hashSessionId,
  serializeRows,
  sha256Hex,
  sortRows,
  type AttemptRow,
  type Manifest,
} from "../src/lib/ranker/dataset";

// Frozen split spec for v1, chosen from the data's shape before any model was
// trained: sessions from Aug 23, 2026 (UTC) on are evaluation-only, and the two
// repos with organic-but-thin traffic are the repo-holdout slice.
const PRIMARY_CUTOFF = "2026-08-23T00:00:00.000Z";
const EVAL_REPOS = ["sindresorhus/p-limit", "lgoyal6/third-degree"];

const url = process.env.KV_REST_API_URL;
const token = process.env.KV_REST_API_READ_ONLY_TOKEN || process.env.KV_REST_API_TOKEN;

async function cmd(...args: (string | number)[]): Promise<unknown> {
  const res = await fetch(url!, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const body = (await res.json()) as { result?: unknown; error?: string };
  if (body.error) throw new Error(body.error);
  return body.result;
}

async function scanSessions(): Promise<GrillSession[]> {
  let cursor = "0";
  const keys: string[] = [];
  do {
    const [next, batch] = (await cmd("SCAN", cursor, "MATCH", "grill:*", "COUNT", "200")) as [
      string,
      string[],
    ];
    cursor = next;
    keys.push(...batch);
  } while (cursor !== "0");

  const sessions: GrillSession[] = [];
  for (const key of keys) {
    const raw = await cmd("GET", key);
    if (!raw) continue;
    sessions.push(typeof raw === "string" ? (JSON.parse(raw) as GrillSession) : (raw as GrillSession));
  }
  return sessions;
}

function rowsOf(session: GrillSession): AttemptRow[] {
  if (session.repo?.private) return []; // never in the dataset
  const repo = `${session.repo.owner}/${session.repo.name}`;
  const byId = new Map(session.questions.map((q, i) => [q.id, { q, position: i }]));
  const out: AttemptRow[] = [];
  for (const attempt of session.attempts ?? []) {
    const hit = byId.get(attempt.questionId);
    if (!hit) continue;
    const { q, position } = hit;
    const hints = attempt.hintsUsed ?? 0;
    const missed =
      attempt.score === null ? (hints > 0 ? true : null) : hints > 0 || attempt.score < PASS_MARK;
    out.push({
      v: 1,
      t: session.createdAt,
      session: hashSessionId(session.id),
      repo,
      mode: session.mode ?? "grill",
      position,
      kind: q.kind,
      layer: q.layer,
      tier: q.gradingTier,
      tags: q.conceptTags?.length ? q.conceptTags : (KIND_TAGS[q.kind] ?? []),
      due: session.reviewing ?? [],
      score: attempt.score,
      hints,
      latencyMs: attempt.latencyMs,
      missed,
      finished: Boolean(session.finishedAt),
      nq: session.questions.length,
    });
  }
  return out;
}

async function main() {
  if (!url || !token) {
    console.error("KV_REST_API_URL and a KV token are required (source .env.local).");
    process.exit(1);
  }
  const sessions = await scanSessions();
  const rows = sortRows(sessions.flatMap(rowsOf));
  if (rows.length === 0) {
    console.error("No attempts found - nothing to build.");
    process.exit(1);
  }

  const jsonl = serializeRows(rows);
  const repoCounts: Record<string, number> = {};
  for (const r of rows) repoCounts[r.repo] = (repoCounts[r.repo] ?? 0) + 1;

  const manifest: Manifest = {
    datasetVersion: DATASET_VERSION,
    file: DATASET_FILE,
    sha256: sha256Hex(jsonl),
    rows: rows.length,
    labeledRows: rows.filter((r) => r.missed !== null).length,
    sessions: new Set(rows.map((r) => r.session)).size,
    repos: repoCounts,
    timeRange: {
      from: new Date(rows[0].t).toISOString(),
      to: new Date(rows[rows.length - 1].t).toISOString(),
    },
    splits: { primaryCutoff: PRIMARY_CUTOFF, evalRepos: EVAL_REPOS },
    provenance:
      "Built by scripts/rank-dataset.ts from the product's stored grill sessions " +
      "(first-party interaction events). No synthetic outcomes, no answer text, " +
      "no prompts; session ids hashed; private repos excluded.",
  };

  const root = process.cwd();
  mkdirSync(path.dirname(path.join(root, DATASET_FILE)), { recursive: true });
  writeFileSync(path.join(root, DATASET_FILE), jsonl);
  writeFileSync(path.join(root, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`wrote ${rows.length} rows (${manifest.labeledRows} labeled) to ${DATASET_FILE}`);
  console.log(`manifest ${MANIFEST_FILE} sha256=${manifest.sha256}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
