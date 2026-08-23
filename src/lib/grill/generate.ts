import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { CodeMap } from "../types";
import type { FileEntry } from "../indexer/walk";
import { buildImportGraph, type ImportGraph } from "../imports";
import { buildSymbolGraph, openProject, type RepoProject, type SymbolRef } from "../indexer/symbols";
import { findHotspots, type Hotspot } from "../indexer/hotspots";
import { mentionsPath, mineCommit, pathWords, type MinedCommit } from "../indexer/history";
import type { ContextCode, GrillQuestion } from "./types";
import { KIND_TAGS, kindsForTags, normalizeTags } from "../learn/tags";

const CODE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

// Field names too generic to grep for safely
const FIELD_STOPLIST = new Set([
  "id", "name", "title", "type", "status", "data", "value", "key", "text",
  "user", "order", "content", "createdat", "updatedat", "index", "label",
]);

function read(root: string, rel: string): string {
  try {
    return readFileSync(path.join(root, rel), "utf8");
  } catch {
    return "";
  }
}

function snippetOf(root: string, file: string, maxLines = 36): ContextCode {
  const lines = read(root, file).split("\n");
  const fnIdx = lines.findIndex((l) =>
    /^(export\s+)?(default\s+)?(async\s+)?function\s|^(export\s+)?const\s+\w+\s*=\s*(async\s*)?\(/.test(l.trim()),
  );
  const start = fnIdx >= 0 ? fnIdx : 0;
  return {
    file,
    code: lines.slice(start, start + maxLines).join("\n"),
    startLine: start + 1,
  };
}

function snippetAt(root: string, file: string, line: number, maxLines = 26): ContextCode {
  const lines = read(root, file).split("\n");
  const start = Math.max(0, line - 3);
  return { file, code: lines.slice(start, start + maxLines).join("\n"), startLine: start + 1 };
}

function q(partial: Omit<GrillQuestion, "id">): GrillQuestion {
  return {
    id: randomUUID(),
    conceptTags: KIND_TAGS[partial.kind],
    ...partial,
  };
}

// ---------- Layer 3: import blast radius ----------

function importQuestions(root: string, graph: ImportGraph, max: number): GrillQuestion[] {
  const ranked = [...graph.importedBy.entries()]
    .filter(([file, users]) => users.size >= 3 && users.size <= 14 && !/components\/ui\//.test(file))
    .sort((a, b) => {
      const prefA = /(lib|server|db|auth|utils|services)\//.test(a[0]) ? 1 : 0;
      const prefB = /(lib|server|db|auth|utils|services)\//.test(b[0]) ? 1 : 0;
      return prefB - prefA || b[1].size - a[1].size;
    })
    .slice(0, max);

  return ranked.map(([file, users]) => {
    const files = [...users].sort();
    return q({
      layer: 3,
      kind: "imports",
      prompt: `You just changed the exported API of \`${file}\`. Which files import it directly and now need a second look? List the file paths.`,
      contextCode: snippetOf(root, file, 24),
      groundTruth: { files, reveal: files.join("\n") },
      gradingTier: 1,
    });
  });
}

// ---------- Layer 3: call-site blast radius (symbol level) ----------

/**
 * §5 Tier 1 at symbol granularity. "Which files import this module" is a
 * weaker question than "which files call this function": the import graph
 * cannot tell a rename that breaks eleven call sites from one that breaks
 * none, and the language service can.
 */
function callSiteQuestions(
  root: string,
  files: FileEntry[],
  max: number,
  repo: RepoProject | null,
): GrillQuestion[] {
  const graph = buildSymbolGraph(root, files, repo);
  const usable = graph
    .filter(
      (s) =>
        s.files.length >= 2 &&
        s.files.length <= 8 &&
        // All-test callers make the answer a test-file listing exercise.
        s.files.some((f) => !/\.(test|spec|stories)\./.test(f)),
    )
    .sort((a, b) => rank(b) - rank(a));

  const out: GrillQuestion[] = [];
  const seenFiles = new Set<string>();
  for (const sym of usable) {
    if (out.length >= max) break;
    // One question per declaring file, so a session is not three questions
    // about lib/db/queries.ts.
    if (seenFiles.has(sym.file)) continue;
    seenFiles.add(sym.file);
    const noun = sym.kind === "function" ? "signature" : sym.kind === "class" ? "constructor" : "shape";
    out.push(
      q({
        layer: 3,
        kind: "call-sites",
        prompt: `You're changing the ${noun} of \`${sym.name}\` in \`${sym.file}\`. Which files use it and have to change with it? List the file paths.`,
        contextCode: snippetAt(root, sym.file, sym.line),
        groundTruth: { files: sym.files, reveal: sym.files.join("\n") },
        gradingTier: 1,
      }),
    );
  }
  return out;
}

/** Shared internals with a handful of callers make the sharpest question. */
function rank(s: SymbolRef): number {
  // Reference count contributes, but capped: past a point a longer answer is a
  // memory test rather than a harder question.
  let n = Math.min(s.refs, 12);
  if (s.kind === "function") n += 6;
  if (/(^|\/)(lib|server|db|core|services)\//.test(s.file)) n += 4;
  if (s.files.length >= 3 && s.files.length <= 5) n += 3;
  if (s.files.length > 6) n -= 4;
  return n;
}

// ---------- Layer 3: what a real change touched (git history) ----------

const COMMIT_SCHEMA = {
  type: "object",
  properties: {
    description: {
      type: "string",
      description:
        "What the change accomplished, in 1-2 sentences, the way you would tell a teammate what shipped. Product terms only. Never name a file, directory, component, function, class or variable, and never quote code — the question is which files it touched.",
    },
  },
  required: ["description"],
  additionalProperties: false,
} as const;

/**
 * §5 Tier 2. The model phrases the change; the diff is the answer key. Every
 * failure path returns nothing, because git mining is opportunistic and must
 * never carry the session.
 */
async function describeCommit(mined: MinedCommit, retryOf?: string): Promise<string | null> {
  const banned = pathWords(mined.files);
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 512,
    output_config: { effort: "low", format: { type: "json_schema", schema: COMMIT_SCHEMA } },
    system:
      "You turn a commit into an interview question for Third Degree. You are given a real diff from the candidate's own repository. Describe what the change did so that someone who knows the codebase could work out where it must have landed, without being told. The description is the only thing they see: the diff and the paths stay hidden.",
    messages: [
      {
        role: "user",
        content: [
          `Commit subject: ${mined.subject}`,
          // Naming a changed file answers the question, and these words name
          // them. The subject usually contains some of them, so it cannot be
          // paraphrased loosely.
          `Words you may not use, in any form: ${banned.join(", ")}`,
          retryOf ? `Your last attempt used one of them: "${retryOf}" — say it another way.` : "",
          "",
          mined.patch,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  });
  if (response.stop_reason === "refusal") return null;
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") return null;
  const { description } = JSON.parse(block.text) as { description: string };
  return description?.trim() || null;
}

async function commitQuestions(map: CodeMap, token?: string): Promise<GrillQuestion[]> {
  const meta = map.meta;
  if (!meta) return [];
  const mined = await mineCommit({ owner: meta.owner, repo: meta.name }, map.sha, token);
  if (!mined) return [];

  try {
    let description = await describeCommit(mined);
    // One rewrite: "Model selector tweaks" is hard to describe without saying
    // it, and a dropped question is worse than a second call.
    if (description && mentionsPath(description, mined.files)) {
      description = await describeCommit(mined, description);
    }
    if (!description || mentionsPath(description, mined.files)) return [];

    return [
      q({
        layer: 3,
        kind: "commit-scope",
        prompt: `A real commit in this repo did this: ${description} Which files did it change? List the paths.`,
        groundTruth: { files: mined.files, reveal: mined.files.join("\n") },
        gradingTier: 1,
      }),
    ];
  } catch {
    return []; // no credentials, or the phrasing call failed
  }
}

// ---------- Layer 3: schema field rename ----------

function fieldRefQuestions(root: string, map: CodeMap, files: FileEntry[]): GrillQuestion[] {
  const out: GrillQuestion[] = [];
  const usedFields = new Set<string>();
  const codeFiles = files.filter(
    (f) => CODE_EXTS.has(f.ext) && f.loc > 0 && !/(\.prisma$|migrations?\/|node_modules)/.test(f.path),
  );

  for (const model of map.models ?? []) {
    if (out.length >= 2) break;
    for (const field of model.fields) {
      const name = field.name;
      if (!name || name.length < 5 || FIELD_STOPLIST.has(name.toLowerCase())) continue;
      if (usedFields.has(name.toLowerCase())) continue;
      const re = new RegExp(`\\b${name}\\b`);
      const refs = codeFiles.filter((f) => f.path !== model.file && re.test(read(root, f.path)));
      if (refs.length < 1 || refs.length > 12) continue;
      const refPaths = refs.map((f) => f.path).sort();
      usedFields.add(name.toLowerCase());
      out.push(
        q({
          layer: 3,
          kind: "field-refs",
          prompt: `You rename \`${model.name}.${name}\` in the schema and regenerate. Which code files reference \`${name}\` and are now broken? List them.`,
          contextCode: snippetOf(root, model.file, 24),
          groundTruth: { files: refPaths, reveal: refPaths.join("\n") },
          gradingTier: 1,
        }),
      );
      break; // one field per model
    }
  }
  return out;
}

// ---------- Layer 2: route handler location ----------

function routeHandlerQuestions(map: CodeMap): GrillQuestion[] {
  const apiRoutes = (map.routes ?? []).filter((r) => r.kind === "api" && r.method !== "*");
  const seen = new Set<string>();
  const picked = [];
  for (const r of apiRoutes) {
    if (seen.has(r.file)) continue;
    seen.add(r.file);
    picked.push(r);
    if (picked.length === 2) break;
  }
  return picked.map((r) =>
    q({
      layer: 2,
      kind: "route-handler",
      prompt: `A \`${r.method} ${r.path}\` request arrives in production. Which file does the framework hand it to?`,
      groundTruth: { files: [r.file], reveal: r.file },
      gradingTier: 1,
    }),
  );
}

// ---------- Layer 2: route → data models ----------

function routeModelQuestions(root: string, map: CodeMap, graph: ImportGraph): GrillQuestion[] {
  const models = map.models ?? [];
  if (models.length === 0) return [];
  const apiRoutes = (map.routes ?? []).filter((r) => r.kind === "api");

  for (const r of apiRoutes) {
    const sources = [r.file, ...(graph.imports.get(r.file) ?? [])];
    const combined = sources.map((s) => read(root, s)).join("\n");
    const touched = models
      .map((m) => m.name)
      .filter((name) => {
        const camel = name[0].toLowerCase() + name.slice(1);
        return new RegExp(`\\b(${name}|${camel})\\b`).test(combined);
      });
    if (touched.length >= 1 && touched.length <= 5) {
      return [
        q({
          layer: 2,
          kind: "route-models",
          prompt: `Which of your data models does \`${r.method === "*" ? "" : r.method + " "}${r.path}\` read or write (directly or through its imports)?`,
          contextCode: snippetOf(root, r.file, 30),
          groundTruth: {
            names: touched,
            reveal: touched.join(", "),
          },
          gradingTier: 1,
        }),
      ];
    }
  }
  return [];
}

// ---------- Layer 1: LLM-phrased snippet questions ----------

const SNIPPET_QUESTIONS_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string" },
          kind: {
            type: "string",
            enum: ["fundamental", "behavior"],
            description:
              "fundamental = about the language/algorithmic construct this code uses (what the array chain produces, why the await matters here, the complexity of this loop, what the data structure choice costs). behavior = what this exact function does, its edge case, or the consequence of a small change.",
          },
          prompt: {
            type: "string",
            description:
              "A sharp question answerable purely from the snippet, with a concrete correct answer. Never abstract trivia ('what is async') — always anchored to THIS code.",
          },
          keyPoints: {
            type: "array",
            items: { type: "string" },
            description: "2-4 facts a correct answer must contain.",
          },
          keySymbols: {
            type: "array",
            items: { type: "string" },
            description: "Function/variable names from the snippet a grounded answer would mention.",
          },
          conceptTags: {
            type: "array",
            items: { type: "string" },
            description:
              "One or two lowercase-hyphenated slugs naming the transferable idea being tested, so the same mistake can resurface on a different repo later: 'stale-closure', 'promise-all-vs-sequential', 'array-of-arrays-flatten'. Name the idea, never this repo's files or symbols, and never give away the answer.",
          },
          reveal: { type: "string", description: "The correct answer in 1-3 sentences." },
        },
        required: ["file", "kind", "prompt", "keyPoints", "keySymbols", "conceptTags", "reveal"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
} as const;

async function snippetQuestions(
  root: string,
  map: CodeMap,
  files: FileEntry[],
  dueTags: string[],
): Promise<GrillQuestion[]> {
  const candidates = files
    .filter(
      (f) =>
        CODE_EXTS.has(f.ext) &&
        f.loc >= 25 &&
        f.loc <= 400 &&
        /(app|pages|src|lib|server|api)\//.test(f.path) &&
        !/\.(test|spec|stories)\./.test(f.path) &&
        !/components\/ui\//.test(f.path),
    )
    .sort((a, b) => b.loc - a.loc)
    .slice(0, 3);
  if (candidates.length === 0) return [];

  const snippets = candidates.map((f) => snippetOf(root, f.path, 40));
  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 3072,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: SNIPPET_QUESTIONS_SCHEMA },
      },
      system:
        "You write interview questions for Third Degree, which grills developers on code they shipped (probably AI-generated). The grilling climbs a ladder, so for EACH snippet write TWO questions: one `fundamental` (the language or algorithmic construct this code leans on — what the chain of array methods produces, what breaks without this await, the complexity of the lookup in the loop, why a Map beats the array here) and one `behavior` (what this exact function does, its edge case, or what a small change would break). Every question must be answerable purely from the snippet, have a concrete correct answer, and sting a little — the kind an interviewer asks when they suspect the candidate didn't write it.",
      messages: [
        {
          role: "user",
          content: [
            // §6: a mistake in one repo comes back from another. The concepts
            // are asked for, never forced — a question about something this
            // code does not do would be a worse question, not a review.
            dueTags.length > 0
              ? `This developer has missed these concepts elsewhere: ${dueTags.join(", ")}. If a snippet genuinely exercises one, make that its question and tag it with that exact slug. If none of them apply to this code, ignore them entirely.\n`
              : "",
            snippets
              .map((s) => `--- ${s.file} (from line ${s.startLine}) ---\n${s.code}`)
              .join("\n\n"),
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    });
    if (response.stop_reason === "refusal") return [];
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return [];
    const parsed = JSON.parse(block.text) as {
      questions: {
        file: string;
        kind: "fundamental" | "behavior";
        prompt: string;
        keyPoints: string[];
        keySymbols: string[];
        conceptTags: string[];
        reveal: string;
      }[];
    };
    // Ground up: all fundamentals before all behavior questions, and inside
    // each group a question that answers a due concept goes first, since the
    // session is capped and the resurfaced one is the one worth keeping.
    const due = new Set(dueTags);
    const returning = (tags: string[]) => (normalizeTags(tags ?? []).some((t) => due.has(t)) ? 0 : 1);
    const sorted = [...parsed.questions].sort(
      (a, b) =>
        (a.kind === "fundamental" ? 0 : 1) - (b.kind === "fundamental" ? 0 : 1) ||
        returning(a.conceptTags) - returning(b.conceptTags),
    );
    return sorted.slice(0, 5).map((gq) =>
      q({
        layer: 1,
        kind: gq.kind === "fundamental" ? "fundamental" : "snippet",
        prompt: gq.prompt,
        contextCode: snippets.find((s) => s.file === gq.file) ?? snippets[0],
        groundTruth: {
          keyPoints: gq.keyPoints,
          keySymbols: gq.keySymbols,
          reveal: gq.reveal,
        },
        conceptTags: normalizeTags(gq.conceptTags ?? []),
        gradingTier: 3,
      }),
    );
  } catch {
    // No credentials or API failure — the deterministic questions carry the session.
    return [];
  }
}

// ---------- Layer 4: scale pressure on a real hot path ----------

/**
 * §3's Layer 4: "10k users, Postgres at 90% CPU, here's your feed query — go."
 * The pressure is scripted, but the target is not: the AST found this loop or
 * this unbounded read in their code, so the question cannot be answered from
 * general knowledge about scaling. Graded on groundedness like any open answer.
 */
const SCALE: Record<
  Hotspot["kind"],
  { ask: (h: Hotspot) => string; keyPoints: string[]; reveal: string; tags: string[] }
> = {
  "await-in-loop": {
    ask: (h) =>
      `Your traffic goes from a handful of users to 10,000 at once. \`${h.fnName}\` in \`${h.file}\` awaits inside a loop — one round trip per iteration, at line ${h.line}. What gives out first, and what do you change in this function?`,
    keyPoints: [
      "one round trip per iteration, so the time grows with the size of the collection",
      "connections or sockets saturate as soon as requests overlap, before CPU does",
      "the fix is one call for the whole set — a join or a batched IN — or bounded concurrency when the calls genuinely cannot be batched",
    ],
    reveal:
      "Every iteration waits for its own round trip, so this function's latency grows linearly with the collection and the pool behind it saturates the moment requests overlap: at 10k concurrent you run out of connections long before you run out of CPU. Fetch the whole set in one call — a join, or a batched IN query — and where the calls truly cannot be batched, run them together with a bounded concurrency instead of one at a time.",
    tags: ["n-plus-one"],
  },
  "unbounded-query": {
    ask: (h) =>
      `The table behind \`${h.fnName}\` in \`${h.file}\` grows to two million rows. The read at line ${h.line} has no limit on it. Walk through what happens to one request and to the process, and say what you change here.`,
    keyPoints: [
      "every matching row is read, serialized and held in memory for the request",
      "latency and heap grow with the largest row set, not the average one",
      "the fix is a limit with keyset pagination on an indexed column, and a hard cap at the handler",
    ],
    reveal:
      "The whole result set is read, serialized and held for the life of the request, so both latency and heap grow with your biggest row set rather than your typical one — the process dies on the busiest chat or the oldest account, not on the average. Put a limit on it with keyset pagination over an indexed column, cap the page size at the handler so a caller cannot ask for everything, and make sure the column you filter on is actually indexed.",
    tags: ["unbounded-query"],
  },
};

function scaleQuestions(root: string, hotspots: Hotspot[], max: number): GrillQuestion[] {
  return hotspots.slice(0, max).map((h) => {
    const copy = SCALE[h.kind];
    return q({
      layer: 4,
      kind: "scale",
      prompt: copy.ask(h),
      contextCode: snippetAt(root, h.file, h.fnStartLine, 24),
      conceptTags: copy.tags,
      groundTruth: {
        keyPoints: copy.keyPoints,
        keySymbols: h.symbols,
        reveal: copy.reveal,
      },
      gradingTier: 3,
    });
  });
}

// ---------- Assembly ----------

export async function generateQuestions(
  root: string,
  map: CodeMap,
  files: FileEntry[],
  opts: { token?: string; dueTags?: string[] } = {},
): Promise<GrillQuestion[]> {
  const graph = buildImportGraph(root, files);
  const dueTags = opts.dueTags ?? [];
  const dueKinds = kindsForTags(dueTags);

  // One parse, two readers: the reference graph and the hot-path scan.
  const repo = openProject(root, files);
  const callSites = callSiteQuestions(root, files, 2, repo);
  const scale = scaleQuestions(
    root,
    findHotspots(repo, (map.models ?? []).map((m) => m.name)),
    1,
  );
  // Both model calls at once: history mining adds a round trip that has no
  // reason to wait for the snippet writer.
  const [snippetSet, commits] = await Promise.all([
    snippetQuestions(root, map, files, dueTags),
    commitQuestions(map, opts.token),
  ]);
  const [snippets, handlers, routeModels, imports, fieldRefs] = [
    snippetSet,
    routeHandlerQuestions(map),
    routeModelQuestions(root, map, graph),
    // Module-level imports are the weakest seam question now that the
    // reference graph and history answer the same thing with exact keys, so it
    // yields its slots to them and to the schema rename — unless its own
    // concept is the one due back, in which case it keeps one.
    importQuestions(
      root,
      graph,
      Math.max(dueKinds.includes("imports") ? 1 : 0, 2 - callSites.length - commits.length),
    ),
    fieldRefQuestions(root, map, files),
  ];

  // §5's target mix is 70% derived-from-the-repo, 30% prose graded by a model.
  // Ten questions with five snippets was an even split; the reference graph is
  // what makes the deterministic side deep enough to carry seven.
  const tier3 = snippets.slice(0, 3);

  // Ground up: fundamentals → functions → modules → seams → the whole system
  // (BUILD_PLAN §3). Layer 4 is last, so it gets a reserved slot rather than
  // being the thing the cap trims.
  const climb = [
    ...tier3,
    ...handlers,
    ...routeModels,
    ...callSites,
    ...commits,
    ...imports,
    ...fieldRefs,
  ];
  const questions =
    scale.length > 0 ? [...climb.slice(0, 10 - scale.length), ...scale] : climb.slice(0, 10);

  if (questions.length < 3) {
    throw new Error(
      "Not enough analyzable structure to grill — TS/JS repos with routes, imports, or a schema work best right now.",
    );
  }
  return questions;
}
