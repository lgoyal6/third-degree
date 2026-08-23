import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { CodeMap } from "../types";
import type { FileEntry } from "../indexer/walk";
import { buildImportGraph, type ImportGraph } from "../imports";
import type { ContextCode, GrillQuestion } from "./types";
import { KIND_TAGS, normalizeTags } from "../learn/tags";

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

function q(partial: Omit<GrillQuestion, "id">): GrillQuestion {
  return {
    id: randomUUID(),
    conceptTags: KIND_TAGS[partial.kind],
    ...partial,
  };
}

// ---------- Layer 3: import blast radius ----------

function importQuestions(root: string, graph: ImportGraph): GrillQuestion[] {
  const ranked = [...graph.importedBy.entries()]
    .filter(([file, users]) => users.size >= 3 && users.size <= 14 && !/components\/ui\//.test(file))
    .sort((a, b) => {
      const prefA = /(lib|server|db|auth|utils|services)\//.test(a[0]) ? 1 : 0;
      const prefB = /(lib|server|db|auth|utils|services)\//.test(b[0]) ? 1 : 0;
      return prefB - prefA || b[1].size - a[1].size;
    })
    .slice(0, 2);

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

async function snippetQuestions(root: string, map: CodeMap, files: FileEntry[]): Promise<GrillQuestion[]> {
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
          content: snippets
            .map((s) => `--- ${s.file} (from line ${s.startLine}) ---\n${s.code}`)
            .join("\n\n"),
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
    // Ground up: all fundamentals before all behavior questions
    const sorted = [...parsed.questions].sort(
      (a, b) => (a.kind === "fundamental" ? 0 : 1) - (b.kind === "fundamental" ? 0 : 1),
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

// ---------- Assembly ----------

export async function generateQuestions(
  root: string,
  map: CodeMap,
  files: FileEntry[],
): Promise<GrillQuestion[]> {
  const graph = buildImportGraph(root, files);

  const [snippets, handlers, routeModels, imports, fieldRefs] = [
    await snippetQuestions(root, map, files),
    routeHandlerQuestions(map),
    routeModelQuestions(root, map, graph),
    importQuestions(root, graph),
    fieldRefQuestions(root, map, files),
  ];

  // Ground up: fundamentals → functions → modules → seams (BUILD_PLAN §3)
  const questions = [...snippets, ...handlers, ...routeModels, ...imports, ...fieldRefs].slice(0, 10);

  if (questions.length < 3) {
    throw new Error(
      "Not enough analyzable structure to grill — TS/JS repos with routes, imports, or a schema work best right now.",
    );
  }
  return questions;
}
