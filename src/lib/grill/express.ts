import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { CodeMap } from "../types";
import { mapPaths } from "../indexer/paths";
import type { GradeResult } from "./grade";
import { extractFileTokens, fileMatched } from "./match";
import type { GrillQuestion } from "./types";

const HUB_COUNT = 8;
const MODEL_CAP = 10;
const ROUTE_CAP = 5;
const PHANTOM_PENALTY = 10;

// Weights from the design spec: the wiring matters most, then the data, then
// the surface. A component the repo doesn't have is dropped and its weight is
// redistributed, so a route-less repo is not capped below 100.
const WEIGHTS = { hub: 0.5, model: 0.3, route: 0.2 } as const;

// Only extension-bearing tokens can be phantoms. "and/or" and "client/server"
// are file-shaped to a regex but are not claims about a file, and a wrong
// -10 is worse than a missed catch.
const CODE_FILE = /\.(tsx?|jsx?|mjs|cjs|prisma|sql|css)$/i;

// "Next.js" and friends are file-shaped to the tokenizer and are never claims
// about a file. Penalizing someone for naming their own framework is absurd.
const FRAMEWORK_WORD =
  /^(next|node|nodejs|nuxt|vue|react|express|nest|three|d3|socket|discord|ember|backbone|knex|jquery)\.js$/i;

// Utility, type and icon modules top the degree ranking in most repos because
// everything imports them, but naming them is not evidence of understanding a
// system. They stay out of the hub set so a real explanation can reach 100.
const GENERIC_HUB =
  /(^|\/)(utils?|types?|constants?|icons?|helpers?|config|styles?)\.(tsx?|jsx?|mjs|cjs)$|(^|\/)components\/ui\//i;

export const EXPRESS_PROMPT =
  "In your own words, explain what this system does and how the pieces connect. Name the actual files and models.";

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nameMatched(answer: string, name: string): boolean {
  return new RegExp(`\\b${escapeRe(name.toLowerCase())}s?\\b`).test(answer.toLowerCase());
}

/**
 * Layer 4: one open question, scored deterministically against the real graph.
 * Everything the grader needs travels in the ground truth, because grading
 * happens in the answer route, which has the session but not the map.
 */
export function buildExpressQuestion(map: CodeMap): GrillQuestion {
  const hubs = (map.graph?.nodes ?? [])
    .filter((n) => !GENERIC_HUB.test(n.id))
    .slice(0, HUB_COUNT)
    .map((n) => ({ file: n.id, weight: Math.max(1, n.deg) }));
  const names = (map.models ?? []).map((m) => m.name).slice(0, MODEL_CAP);
  const routeFiles = [
    ...new Set(
      [...(map.routes ?? [])]
        .sort((a, b) => (a.kind === "api" ? 0 : 1) - (b.kind === "api" ? 0 : 1))
        .map((r) => r.file),
    ),
  ].slice(0, ROUTE_CAP);
  const filePaths = map.filePaths?.length ? map.filePaths : mapPaths(map);

  const revealParts = [
    hubs.length > 0
      ? `Load-bearing files: ${hubs.map((h) => `${h.file} (${h.weight} imports)`).join(", ")}`
      : null,
    names.length > 0 ? `Data models: ${names.join(", ")}` : null,
    routeFiles.length > 0 ? `Routes live in: ${routeFiles.join(", ")}` : null,
  ].filter(Boolean);

  return {
    id: randomUUID(),
    layer: 4,
    kind: "overview",
    prompt: EXPRESS_PROMPT,
    groundTruth: {
      hubs,
      names,
      files: routeFiles,
      filePaths,
      reveal: revealParts.join("\n"),
    },
    gradingTier: 1,
  };
}

interface Coverage {
  hub: number | null;
  model: number | null;
  route: number | null;
  missedHubs: string[];
  matchedHubs: string[];
  missedModels: string[];
  matchedModels: string[];
  missedRoutes: string[];
  matchedRoutes: string[];
  phantoms: string[];
}

/**
 * A token is grounded when a real path carries the same filename. The directory
 * may be wrong — misremembering where a real file lives is ordinary — but an
 * invented filename is the tell, so basenames must match exactly.
 */
function isGrounded(token: string, known: string[]): boolean {
  const base = token.split("/").pop() ?? token;
  return known.some((p) => {
    const path = p.toLowerCase();
    return path === token || path.endsWith(`/${token}`) || (path.split("/").pop() ?? path) === base;
  });
}

function coverageOf(question: GrillQuestion, answer: string): Coverage {
  const gt = question.groundTruth;
  const hubs = gt.hubs ?? [];
  const names = gt.names ?? [];
  const routes = gt.files ?? [];
  const known = gt.filePaths ?? [];

  const matchedHubs = hubs.filter((h) => fileMatched(answer, h.file));
  const hubTotal = hubs.reduce((s, h) => s + h.weight, 0);
  const matchedModels = names.filter((n) => nameMatched(answer, n));
  const matchedRoutes = routes.filter((f) => fileMatched(answer, f));

  // A developer who absorbed a codebase from an AI names the file where it
  // conventionally lives rather than where theirs lives. That is the tell.
  const seen = new Set<string>();
  const phantoms: string[] = [];
  // URLs are file-shaped and never claims about the repo.
  const prose = answer.replace(/https?:\/\/\S+/g, " ");
  for (const raw of extractFileTokens(prose)) {
    const token = raw.replace(/^[./]+/, "");
    if (!CODE_FILE.test(token) || FRAMEWORK_WORD.test(token)) continue;
    const lower = token.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    if (!isGrounded(lower, known)) phantoms.push(token);
  }

  return {
    hub: hubs.length > 0 ? matchedHubs.reduce((s, h) => s + h.weight, 0) / hubTotal : null,
    model: names.length > 0 ? matchedModels.length / names.length : null,
    route: routes.length > 0 ? matchedRoutes.length / routes.length : null,
    matchedHubs: matchedHubs.map((h) => h.file),
    missedHubs: hubs.filter((h) => !matchedHubs.includes(h)).map((h) => h.file),
    matchedModels,
    missedModels: names.filter((n) => !matchedModels.includes(n)),
    matchedRoutes,
    missedRoutes: routes.filter((f) => !matchedRoutes.includes(f)),
    phantoms,
  };
}

function scoreOf(c: Coverage): number {
  const present = (["hub", "model", "route"] as const).filter((k) => c[k] !== null);
  const total = present.reduce((s, k) => s + WEIGHTS[k], 0);
  if (total === 0) return 0;
  const weighted = present.reduce((s, k) => s + (WEIGHTS[k] / total) * (c[k] ?? 0), 0);
  return Math.max(0, Math.min(100, Math.round(100 * weighted) - PHANTOM_PENALTY * c.phantoms.length));
}

function templateFeedback(c: Coverage): string {
  const parts: string[] = [];
  if (c.hub !== null) {
    parts.push(
      `You named ${c.matchedHubs.length} of the ${c.matchedHubs.length + c.missedHubs.length} load-bearing files`,
    );
  }
  if (c.model !== null) {
    parts.push(`${c.matchedModels.length} of ${c.matchedModels.length + c.missedModels.length} models`);
  }
  if (c.route !== null) {
    parts.push(`${c.matchedRoutes.length} of ${c.matchedRoutes.length + c.missedRoutes.length} route files`);
  }
  let text = parts.length > 0 ? `${parts.join(", ")}.` : "Nothing in this repo to match your answer against.";
  const missed = [...c.missedHubs.slice(0, 3), ...c.missedModels.slice(0, 2)];
  if (missed.length > 0) text += ` You walked past ${missed.join(", ")}.`;
  return text;
}

function phantomLines(c: Coverage): string {
  return c.phantoms
    .slice(0, 3)
    .map((p) => ` You referenced ${p}. That file does not exist in this repo.`)
    .join("");
}

const FEEDBACK_SCHEMA = {
  type: "object",
  properties: {
    feedback: {
      type: "string",
      description:
        "One or two blunt sentences on how grounded the explanation was, naming the specific files or models that were missed. Address them as 'you'. Never state a number or a grade.",
    },
  },
  required: ["feedback"],
  additionalProperties: false,
} as const;

async function proseFeedback(c: Coverage, answer: string): Promise<string | null> {
  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 512,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: FEEDBACK_SCHEMA },
      },
      system:
        "You write the feedback line for Third Degree's Layer 4 question, where someone claims to already know a repo and explains it in their own words. The score is already computed from the real import graph and is none of your business — never mention or imply a number. Say what their explanation was grounded in and what they walked past, using the file and model names given. Blunt, specific, no praise, no encouragement.",
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            matchedFiles: c.matchedHubs,
            missedFiles: c.missedHubs,
            matchedModels: c.matchedModels,
            missedModels: c.missedModels,
            matchedRouteFiles: c.matchedRoutes,
            missedRouteFiles: c.missedRoutes,
            theirAnswer: answer.slice(0, 4000),
          }),
        },
      ],
    });
    if (response.stop_reason === "refusal") return null;
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return null;
    const parsed = JSON.parse(block.text) as { feedback?: string };
    return parsed.feedback?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Deterministic score, model-written prose. The model never contributes to the
 * number (BUILD_PLAN §5), and phantom callouts are appended by hand so the
 * central mechanic surfaces even when the prose skips it.
 */
export async function gradeOverviewAnswer(
  question: GrillQuestion,
  answer: string,
): Promise<GradeResult> {
  const coverage = coverageOf(question, answer);
  const score = scoreOf(coverage);
  const prose = await proseFeedback(coverage, answer);
  return { score, feedback: (prose ?? templateFeedback(coverage)) + phantomLines(coverage) };
}
