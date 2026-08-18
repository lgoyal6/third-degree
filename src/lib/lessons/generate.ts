import Anthropic from "@anthropic-ai/sdk";
import type { CategoryNode, CodeMap, LessonCard } from "../types";
import { buildFacts } from "../indexer/summary";

const MAX_CARDS = 6;
const MAX_ALLOWED_PATHS = 60;

const LESSONS_SCHEMA = {
  type: "object",
  properties: {
    cards: {
      type: "array",
      items: {
        type: "object",
        properties: {
          using: {
            type: "string",
            description:
              "The choice as shipped, named exactly: a framework, library, or architectural decision visible in the facts (\"Drizzle ORM\", \"Next.js App Router\", \"Tailwind CSS\", \"no ORM — raw SQL\").",
          },
          insteadOf: {
            type: "string",
            description: "The one or two alternatives it was picked over, comma separated (\"Prisma, or raw SQL\").",
          },
          whyItFits: {
            type: "string",
            description:
              "Two or three sentences on why this choice suits THIS repo, citing counts and paths from the facts. Teach the tradeoff; never praise the code.",
          },
          whatItCosts: {
            type: "string",
            description:
              "One or two sentences on the tradeoff this choice accepts — what gets harder, slower, or locked in. Concrete, not hedged.",
          },
          evidence: {
            type: "array",
            items: { type: "string" },
            description:
              "One to three paths copied verbatim from the allowed paths list. Never invent or adjust a path.",
          },
          definingRank: {
            type: "integer",
            description: "1 means this choice defines the app most; higher numbers matter less.",
          },
        },
        required: ["using", "insteadOf", "whyItFits", "whatItCosts", "evidence", "definingRank"],
        additionalProperties: false,
      },
    },
  },
  required: ["cards"],
  additionalProperties: false,
} as const;

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function sampleFiles(nodes: CategoryNode[]): string[] {
  return nodes.flatMap((c) => [...c.sampleFiles, ...sampleFiles(c.children)]);
}

/**
 * Every path the map itself proves exists. The lesson deck may only link to
 * these — a card that cites anything else is dropped rather than shipped,
 * because a deck that links to a file that isn't there is worse than no deck.
 */
function knownPaths(map: CodeMap): string[] {
  return uniq([
    ...(map.entryPoints ?? []),
    ...(map.routes ?? []).map((r) => r.file),
    ...(map.models ?? []).map((m) => m.file),
    ...(map.graph?.nodes ?? []).map((n) => n.id),
    ...sampleFiles(map.categories ?? []),
  ]);
}

function normalizePath(raw: string): string {
  return raw.trim().replace(/^[`'"]|[`'"]$/g, "").replace(/^\.?\//, "");
}

function fallbackDeck(map: CodeMap): LessonCard[] {
  const paths = new Set(knownPaths(map));
  const hubs = (map.graph?.nodes ?? []).slice(0, 3).map((n) => n.id);
  const routeFiles = uniq((map.routes ?? []).map((r) => r.file)).slice(0, 3);
  const modelFiles = uniq((map.models ?? []).map((m) => m.file)).slice(0, 2);
  const entry = (map.entryPoints ?? []).filter((p) => paths.has(p)).slice(0, 1);
  const anchors = routeFiles.length > 0 ? routeFiles : hubs;
  const cards: LessonCard[] = [];

  // Deterministic and honest: without a model call there is no tradeoff prose to
  // give, so the cards name the choices and point at real code. One card for the
  // whole stack rather than one per framework — four near-identical cards read
  // as filler, and §7 would rather show less.
  const frameworks = map.stack?.frameworks ?? [];
  if (frameworks.length > 0) {
    cards.push({
      using: frameworks.join(" + "),
      whyItFits: `The stack this repo declares${
        map.stack?.packageManager ? ` in its ${map.stack.packageManager} manifest` : ""
      }: ${frameworks.length} framework${frameworks.length === 1 ? "" : "s"} across ${
        map.totalFiles ?? 0
      } files${
        routeFiles.length > 0 ? ` and ${map.routes?.length ?? 0} routes` : ""
      }. Read without an LLM, so this card names the choices and where the code sits rather than the tradeoffs.`,
      evidence: anchors,
    });
  }

  const lang = map.languages?.[0];
  if (lang && cards.length < MAX_CARDS) {
    cards.push({
      using: lang.name,
      whyItFits: `${lang.pct}% of ${map.totalFiles ?? lang.files} files${
        entry.length > 0 ? `, entered at ${entry[0]}` : ""
      }.`,
      evidence: entry.length > 0 ? entry : hubs.slice(0, 1),
    });
  }

  if (modelFiles.length > 0 && cards.length < MAX_CARDS) {
    const source = uniq((map.models ?? []).map((m) => m.source)).join(", ");
    cards.push({
      using: `${map.models?.length} data models via ${source}`,
      whyItFits: `Defined in ${modelFiles.join(", ")}. Every route that touches this data goes through those definitions.`,
      evidence: modelFiles,
    });
  }

  const hub = map.graph?.nodes?.[0];
  if (hub && cards.length < MAX_CARDS) {
    cards.push({
      using: `${hub.id} as the hub`,
      whyItFits: `The most-connected file in the repo: ${hub.deg} imports in and out. Change its exports and the blast radius is the widest in the codebase.`,
      evidence: [hub.id],
    });
  }

  return cards.slice(0, MAX_CARDS);
}

/**
 * Layer 0.5: the stack choices this repo actually made, taught before the owner
 * is tested on them (BUILD_PLAN §3). Ground truth stays with the repo — counts,
 * paths, and framework detection all come from the map, and the model supplies
 * only the comparison and tradeoff prose (BUILD_PLAN §5).
 */
export async function generateLessons(map: CodeMap): Promise<LessonCard[]> {
  const allowed = knownPaths(map);
  if (allowed.length === 0) return fallbackDeck(map);
  const allowedSet = new Set(allowed);

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4096,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: LESSONS_SCHEMA },
      },
      system:
        "You write the lesson deck for Third Degree, which teaches developers the stack choices their own repo made before grilling them on it. One card per choice, at most six, ordered so the choice that defines the app comes first. Only name choices the facts support — never guess at a library that isn't there. The comparison and the cost are yours to write; the counts and paths are not, so cite them exactly as given. Never praise the code, never pad, and never write a card that would read the same for any other repo.",
      messages: [
        {
          role: "user",
          content: `Facts extracted from the repo:\n${buildFacts(map)}\n\nAllowed evidence paths — copy verbatim, never invent:\n${allowed
            .slice(0, MAX_ALLOWED_PATHS)
            .join("\n")}\n\nWrite the deck.`,
        },
      ],
    });
    if (response.stop_reason === "refusal") return fallbackDeck(map);
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return fallbackDeck(map);

    const parsed = JSON.parse(block.text) as {
      cards: {
        using: string;
        insteadOf: string;
        whyItFits: string;
        whatItCosts: string;
        evidence: string[];
        definingRank: number;
      }[];
    };

    const cards = [...(parsed.cards ?? [])]
      .sort((a, b) => (a.definingRank ?? 99) - (b.definingRank ?? 99))
      .map((c) => ({
        using: c.using?.trim() ?? "",
        insteadOf: c.insteadOf?.trim() || undefined,
        whyItFits: c.whyItFits?.trim() ?? "",
        whatItCosts: c.whatItCosts?.trim() || undefined,
        evidence: uniq((c.evidence ?? []).map(normalizePath)).filter((p) => allowedSet.has(p)),
      }))
      .filter((c) => c.using && c.whyItFits && c.evidence.length > 0)
      .slice(0, MAX_CARDS);

    return cards.length > 0 ? cards : fallbackDeck(map);
  } catch {
    // No credentials, network failure, or malformed output — the deck still ships.
    return fallbackDeck(map);
  }
}
