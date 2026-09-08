import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CodeMap } from "../types";
import { walkRepo, type FileEntry } from "../indexer/walk";
import { FEATURE_NAMES } from "../ranker/features";
import { MODEL_VERSION, type TrainedModel } from "../ranker/model";
import { generateQuestions } from "./generate";

// The deterministic generators must carry this test: no model calls, ever.
delete process.env.ANTHROPIC_API_KEY;

/**
 * End-to-end: a real (tiny) repository on disk, walked and parsed by the real
 * indexer, questions assembled by the real generator - proving the baseline
 * path is untouched without a model, and that the learned path only reorders
 * within layers, with cold-start and fallback behavior intact.
 */

let root: string;
let files: FileEntry[];
let map: CodeMap;

function write(rel: string, content: string): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "td-fixture-"));
  write(
    "lib/db.ts",
    [
      "export interface UserRow {",
      "  id: string;",
      "  emailAddress: string;",
      "}",
      "",
      "const table: UserRow[] = [];",
      "",
      "export function findUserByEmail(emailAddress: string): UserRow | undefined {",
      "  return table.find((row) => row.emailAddress === emailAddress);",
      "}",
      "",
      "export function insertUser(row: UserRow): void {",
      "  table.push(row);",
      "}",
      "",
    ].join("\n"),
  );
  write(
    "lib/auth.ts",
    [
      'import { findUserByEmail } from "./db";',
      "",
      "export function authenticate(email: string): boolean {",
      "  const user = findUserByEmail(email);",
      "  return Boolean(user);",
      "}",
      "",
    ].join("\n"),
  );
  write(
    "lib/notify.ts",
    [
      'import { findUserByEmail } from "./db";',
      "",
      "export function notifyByEmail(email: string): string | null {",
      "  const user = findUserByEmail(email);",
      "  return user ? `sent to ${user.emailAddress}` : null;",
      "}",
      "",
    ].join("\n"),
  );
  write(
    "app/api/users/route.ts",
    [
      'import { findUserByEmail } from "../../../lib/db";',
      "",
      "export function GET(request: Request): Response {",
      '  const email = new URL(request.url).searchParams.get("email") ?? "";',
      "  const user = findUserByEmail(email);",
      "  return Response.json(user ?? null);",
      "}",
      "",
    ].join("\n"),
  );
  write(
    "app/api/posts/route.ts",
    [
      'import { insertUser } from "../../../lib/db";',
      "",
      "export function POST(): Response {",
      '  insertUser({ id: "1", emailAddress: "a@b.c" });',
      "  return Response.json({ ok: true });",
      "}",
      "",
    ].join("\n"),
  );
  files = walkRepo(root).files;
  map = {
    routes: [
      { kind: "api", method: "GET", path: "/api/users", file: "app/api/users/route.ts" },
      { kind: "api", method: "POST", path: "/api/posts", file: "app/api/posts/route.ts" },
    ],
    models: [
      {
        name: "User",
        fields: [{ name: "emailAddress", type: "text" }],
        source: "drizzle",
        file: "lib/db.ts",
      },
    ],
  };
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A model whose only opinion is the per-kind miss rate; all inputs in range. */
function testModel(overrides: Partial<TrainedModel> = {}): TrainedModel {
  const d = FEATURE_NAMES.length;
  const weights = new Array<number>(d).fill(0);
  weights[FEATURE_NAMES.indexOf("kindMissRate")] = 4;
  return {
    version: MODEL_VERSION,
    featureNames: [...FEATURE_NAMES],
    mean: new Array<number>(d).fill(0.5),
    std: new Array<number>(d).fill(0.5),
    weights,
    bias: 0,
    zClip: 6,
    seenKinds: ["route-handler", "route-models", "call-sites", "imports", "field-refs"],
    kindStats: {
      "route-handler": { attempts: 10, misses: 1 },
      "route-models": { attempts: 10, misses: 9 },
      "call-sites": { attempts: 10, misses: 2 },
      imports: { attempts: 10, misses: 5 },
      "field-refs": { attempts: 10, misses: 8 },
    },
    globalMissRate: 0.5,
    trainedOn: { datasetVersion: "test", sha256: "x", rows: 50, positives: 25 },
    ...overrides,
  };
}

const signature = (qs: { kind: string; prompt: string }[]) => qs.map((q) => `${q.kind}:${q.prompt}`);

describe("generateQuestions end to end", () => {
  it("baseline: deterministic ladder order without a model", async () => {
    const a = await generateQuestions(root, map, files, {});
    const b = await generateQuestions(root, map, files, {});
    expect(signature(a)).toEqual(signature(b));
    expect(a.map((q) => q.kind)).toEqual([
      "route-handler",
      "route-handler",
      "route-models",
      "call-sites",
      "imports",
      "field-refs",
      "scale",
    ]);
    // The ladder climbs and never dips.
    const layers = a.map((q) => q.layer);
    expect([...layers].sort((x, y) => x - y)).toEqual(layers);
  });

  it("learned arm: reorders within layers only, deterministically", async () => {
    const baseline = await generateQuestions(root, map, files, {});
    const ranked = await generateQuestions(root, map, files, { rankModel: testModel() });
    const rankedAgain = await generateQuestions(root, map, files, { rankModel: testModel() });
    expect(signature(ranked)).toEqual(signature(rankedAgain));
    // Same questions, same layer sequence, different order inside the layers.
    expect(signature(ranked).sort()).toEqual(signature(baseline).sort());
    expect(ranked.map((q) => q.layer)).toEqual(baseline.map((q) => q.layer));
    expect(ranked.map((q) => q.kind)).toEqual([
      "route-models", // hardest layer-2 kind moves up
      "route-handler",
      "route-handler",
      "field-refs", // hardest layer-3 kind moves up
      "imports",
      "call-sites",
      "scale", // layer 4 stays last: the ladder never reorders across layers
    ]);
  });

  it("fallback: an invalid model leaves the baseline order untouched", async () => {
    const baseline = await generateQuestions(root, map, files, {});
    const broken = testModel({ weights: testModel().weights.map(() => NaN) });
    const ranked = await generateQuestions(root, map, files, { rankModel: broken });
    expect(signature(ranked)).toEqual(signature(baseline));
  });

  it("fallback: out-of-distribution features leave the baseline order untouched", async () => {
    const baseline = await generateQuestions(root, map, files, {});
    const tight = testModel({ std: testModel().std.map(() => 1e-9) });
    const ranked = await generateQuestions(root, map, files, { rankModel: tight });
    expect(signature(ranked)).toEqual(signature(baseline));
  });

  it("cold start: a new user (no due tags) gets the same learned order every time", async () => {
    const a = await generateQuestions(root, map, files, { rankModel: testModel(), dueTags: [] });
    const b = await generateQuestions(root, map, files, { rankModel: testModel() });
    expect(signature(a)).toEqual(signature(b));
  });

  it("cold start: kinds the model never saw keep their baseline slots", async () => {
    const partial = testModel({ seenKinds: ["imports", "field-refs"] });
    const baseline = await generateQuestions(root, map, files, {});
    const ranked = await generateQuestions(root, map, files, { rankModel: partial });
    // Layer 2 is untouched (no seen kinds there); within layer 3 the unseen
    // call-sites question holds slot 3 while imports/field-refs swap.
    expect(ranked.map((q) => q.kind)).toEqual([
      "route-handler",
      "route-handler",
      "route-models",
      "call-sites",
      "field-refs",
      "imports",
      "scale",
    ]);
    expect(signature(ranked).sort()).toEqual(signature(baseline).sort());
  });
});
