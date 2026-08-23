import Anthropic from "@anthropic-ai/sdk";
import type { CodeMap } from "../types";
import type { ReviewCard } from "../review";
import { groupMastery, masteryOf, type Mastery } from "./mastery";

/**
 * The full curriculum (BUILD_PLAN §10a): ordered modules, prerequisites,
 * mastery per concept tag, and rebuilding your own project as the capstone.
 *
 * §8 forbids the obvious way to build this — a hand-curated ontology with
 * prerequisites — and says to formalize later, once real data shows which
 * concepts recur. So nothing here is authored. The concepts are the ones their
 * own answers produced, the order comes from the §3 layer each was tested at,
 * and the model's only job is naming groups from a list it is handed. It cannot
 * add a concept, and anything it invents is dropped.
 */

export interface Module {
  title: string;
  why: string;
  tags: string[];
  /** Position on §3's ladder, which is what orders the path. */
  layer: number;
  mastery: { score: number; confident: boolean };
  /** The module before it, when the ladder puts one there. Guidance, not a gate. */
  after?: string;
}

export interface CapstoneStep {
  title: string;
  detail: string;
  files: string[];
  tags: string[];
}

export interface Capstone {
  repo: string;
  steps: CapstoneStep[];
}

export interface Curriculum {
  modules: Module[];
  capstone?: Capstone;
  /** Every concept they have, with its level, for the per-tag view. */
  mastery: Mastery[];
}

// Files every project has, which say nothing about this one.
const GENERIC_HUB =
  /(^|\/)(utils?|types?|constants?|config|helpers?|styles?|index)\.[tj]sx?$|(^|\/)components\/ui\//;

const LAYER_TITLES: Record<number, { title: string; why: string }> = {
  1: {
    title: "The language you shipped",
    why: "Constructs your own code leans on, where being wrong is quiet.",
  },
  2: {
    title: "How your app is wired",
    why: "Which file answers which request, and what data it touches.",
  },
  3: {
    title: "What breaks when you change it",
    why: "Blast radius: the seams where a rename becomes an outage.",
  },
  4: {
    title: "Under pressure",
    why: "The same code with a thousand times the rows or the traffic.",
  },
};

const MODULE_SCHEMA = {
  type: "object",
  properties: {
    modules: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description:
              "Three to six words naming what these concepts have in common, in a developer's words. Not a course title, no numbering, no colons.",
          },
          why: {
            type: "string",
            description: "One sentence: why knowing this group changes what they can do.",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description:
              "The slugs from the given list that belong in this module, copied exactly. Never invent one, and never repeat one that is already in another module.",
          },
        },
        required: ["title", "why", "tags"],
        additionalProperties: false,
      },
    },
  },
  required: ["modules"],
  additionalProperties: false,
} as const;

/** Groups by the layer each concept was tested at. No model, always available. */
function byLayer(mastery: Mastery[]): Module[] {
  const out: Module[] = [];
  for (const layer of [1, 2, 3, 4]) {
    const items = mastery.filter((m) => m.layer === layer);
    if (items.length === 0) continue;
    const copy = LAYER_TITLES[layer];
    out.push({
      title: copy.title,
      why: copy.why,
      tags: items.map((m) => m.tag),
      layer,
      mastery: groupMastery(items),
    });
  }
  return out;
}

async function named(mastery: Mastery[]): Promise<Module[] | null> {
  if (mastery.length < 4) return null; // too few concepts for grouping to mean anything
  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 2048,
      output_config: { effort: "low", format: { type: "json_schema", schema: MODULE_SCHEMA } },
      system:
        "You group concepts into a study path for Third Degree. The list is not a syllabus: it is the set of ideas this developer's own wrong answers produced, about code they shipped. Group them into three to six modules by what a developer would actually study together, and name each one plainly. You may only use the slugs given to you, each in one module at most. Leave out anything that fits nowhere rather than forcing it.",
      messages: [
        {
          role: "user",
          content: JSON.stringify(
            mastery.map((m) => ({
              tag: m.tag,
              testedAtLayer: m.layer,
              level: m.level,
              attempts: m.attempts,
            })),
          ),
        },
      ],
    });
    if (response.stop_reason === "refusal") return null;
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return null;
    const parsed = JSON.parse(block.text) as {
      modules: { title: string; why: string; tags: string[] }[];
    };

    const known = new Map(mastery.map((m) => [m.tag, m]));
    const used = new Set<string>();
    const out: Module[] = [];
    for (const group of parsed.modules ?? []) {
      // Only their own concepts, once each: a module that invents a topic would
      // be a syllabus, which is the thing §8 rules out.
      const items = (group.tags ?? [])
        .map((tag) => known.get(tag))
        .filter((m): m is Mastery => Boolean(m) && !used.has(m!.tag));
      if (items.length === 0) continue;
      for (const m of items) used.add(m.tag);
      out.push({
        title: group.title.slice(0, 60),
        why: group.why.slice(0, 160),
        tags: items.map((m) => m.tag),
        // Anchored at the earliest layer it touches, so the path still climbs.
        layer: Math.min(...items.map((m) => m.layer)),
        mastery: groupMastery(items),
      });
    }
    // Anything the model left out still belongs to them.
    const leftover = mastery.filter((m) => !used.has(m.tag));
    return [...out, ...byLayer(leftover)];
  } catch {
    return null;
  }
}

/**
 * "Rebuild your own project", derived from the map rather than described in
 * general terms: their models, their entry point, their busiest route, their
 * most-imported file, in the order you would actually build them.
 */
function capstoneFor(map: CodeMap, have: Set<string>): Capstone | undefined {
  const meta = map.meta;
  if (!meta) return undefined;
  const tags = (candidates: string[]) => candidates.filter((tag) => have.has(tag));

  const models = (map.models ?? []).slice(0, 6);
  // Endpoints first, then one page: rebuilding an API route teaches more than
  // rebuilding a layout, and a catch-all page is nobody's second step.
  const all = map.routes ?? [];
  const routes = [
    ...all.filter((r) => r.kind === "api").slice(0, 2),
    ...all.filter((r) => r.kind === "page").slice(0, 1),
  ];
  const entry = (map.entryPoints ?? [])[0];
  // The busiest file, unless it is the one every repo has: "rebuild utils.ts
  // last" is true and useless.
  const hub = [...(map.graph?.nodes ?? [])]
    .filter((n) => !GENERIC_HUB.test(n.id))
    .sort((a, b) => b.deg - a.deg)[0];

  const steps: CapstoneStep[] = [];
  if (models.length > 0) {
    steps.push({
      title: "The data model, from nothing",
      detail: `Write the schema again without looking: ${models.map((m) => m.name).join(", ")}. Every field you cannot justify is one you did not choose.`,
      files: [...new Set(models.map((m) => m.file).filter(Boolean))].slice(0, 3),
      tags: tags(["schema-rename-blast-radius", "route-data-flow"]),
    });
  }
  if (entry) {
    steps.push({
      title: "Boot it",
      detail: `Recreate the entry point and get it running with nothing behind it. ${entry} is where the framework takes over from you.`,
      files: [entry],
      tags: tags(["file-based-routing", "system-overview"]),
    });
  }
  for (const route of routes) {
    steps.push({
      title:
        route.kind === "api"
          ? `${route.method && route.method !== "*" ? `${route.method} ` : ""}${route.path}, end to end`
          : `The ${route.path} page, end to end`,
      detail:
        route.kind === "api"
          ? "Handler, validation, the data it touches, the failure cases. One route done properly teaches more than five stubbed."
          : "What it loads, what it shows while loading, and what it shows when there is nothing to show. The empty state is the part people skip.",
      files: [route.file].filter(Boolean),
      tags: tags(["file-based-routing", "route-data-flow"]),
    });
  }
  if (hub) {
    steps.push({
      title: "The part everything leans on",
      detail: `${hub.id} is imported more than anything else here. Build it last, now that you know what actually needs it, and see whether it still deserves that shape.`,
      files: [hub.id],
      tags: tags(["import-blast-radius", "call-site-blast-radius"]),
    });
  }
  steps.push({
    title: "Then break it on purpose",
    detail: "Ten thousand users, the biggest row set you can imagine, the slowest network. Find what gives out first before someone else does.",
    files: [],
    tags: tags(["scale-pressure", "n-plus-one", "unbounded-query"]),
  });

  return steps.length > 1 ? { repo: `${meta.owner}/${meta.name}`, steps } : undefined;
}

export async function buildCurriculum(
  cards: ReviewCard[],
  map?: CodeMap,
): Promise<Curriculum> {
  // Weakest first inside the ladder: the path is for studying, not for admiring.
  const mastery = cards.map(masteryOf).sort((a, b) => a.layer - b.layer || a.score - b.score);

  const modules = ((await named(mastery)) ?? byLayer(mastery)).sort(
    (a, b) => a.layer - b.layer || a.mastery.score - b.mastery.score,
  );
  // Prerequisites, as the ladder gives them: guidance about order, never a lock
  // on the door (§7 — no screen that refuses to be used).
  for (let i = 1; i < modules.length; i++) {
    if (modules[i].layer > modules[i - 1].layer) modules[i].after = modules[i - 1].title;
  }

  return {
    modules,
    capstone: map ? capstoneFor(map, new Set(cards.map((c) => c.tag))) : undefined,
    mastery,
  };
}
