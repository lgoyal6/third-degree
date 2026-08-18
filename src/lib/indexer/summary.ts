import Anthropic from "@anthropic-ai/sdk";
import type { CodeMap, MapSummary } from "../types";

const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "Exactly three sentences describing what this app does and how it is built, grounded only in the provided facts.",
    },
    structure: {
      type: "string",
      description:
        "Three to five sentences walking the owner through how the code is organized: where a request enters, where the logic lives, where data is defined, and which hub files everything flows through. Name real directories and files from the facts. Written to teach, not to summarize.",
    },
    startHereFile: {
      type: "string",
      description: "The single best file for the owner to re-read first — an entry point or the busiest seam.",
    },
    startHereReason: {
      type: "string",
      description: "One sentence on why that file is the right starting point.",
    },
  },
  required: ["summary", "structure", "startHereFile", "startHereReason"],
  additionalProperties: false,
} as const;

function buildFacts(map: CodeMap): string {
  return JSON.stringify(
    {
      repo: map.meta ? `${map.meta.owner}/${map.meta.name}` : undefined,
      description: map.meta?.description,
      languages: map.languages?.map((l) => `${l.name} ${l.pct}%`),
      frameworks: map.stack?.frameworks,
      scripts: map.stack?.scripts,
      entryPoints: map.entryPoints,
      routes: map.routes?.slice(0, 40).map((r) => `${r.method} ${r.path}`),
      models: map.models?.map((m) => `${m.name}(${m.fields.map((f) => f.name).join(",")})`),
      categories: map.categories?.map(
        (c) => `${c.name}: ${c.files} files / ${c.loc} loc (${c.children.slice(0, 4).map((s) => s.name).join(", ")})`,
      ),
      hubFiles: map.graph?.nodes.slice(0, 8).map((n) => `${n.id} (${n.deg} connections)`),
    },
    null,
    1,
  );
}

function fallbackSummary(map: CodeMap): MapSummary {
  const fw = map.stack?.frameworks?.slice(0, 3).join(", ") || "no detected framework";
  const lang = map.languages?.[0]?.name ?? "code";
  const routeCount = map.routes?.filter((r) => r.kind !== "middleware").length ?? 0;
  const modelCount = map.models?.length ?? 0;
  const startHere = map.entryPoints?.[0] ?? map.routes?.[0]?.file ?? "package.json";
  const catLine = (map.categories ?? [])
    .map((c) => `${c.name} is ${c.files} files (mostly ${c.children[0]?.name.toLowerCase() ?? "misc"})`)
    .join("; ");
  const hubs = (map.graph?.nodes ?? []).slice(0, 3).map((n) => n.id).join(", ");
  return {
    text: `A ${lang} app built with ${fw}. It exposes ${routeCount} route${routeCount === 1 ? "" : "s"} and defines ${modelCount} data model${modelCount === 1 ? "" : "s"}. Generated without an LLM — set ANTHROPIC_API_KEY for a real summary.`,
    structure: `${catLine || "One flat pile of files"}.${hubs ? ` Everything flows through ${hubs} — start reading there and the rest follows.` : ""}`,
    startHere: { file: startHere, reason: "Main entry point of the app." },
    generatedBy: "fallback",
  };
}

export async function summarize(map: CodeMap): Promise<MapSummary> {
  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: SUMMARY_SCHEMA },
      },
      system:
        "You write the Layer 0 orientation summary for Third Degree, a tool that maps a code repo back to its owner. Be concrete and specific to the facts given — name the actual frameworks and routes. Never pad, never praise the code.",
      messages: [
        {
          role: "user",
          content: `Facts extracted from the repo:\n${buildFacts(map)}\n\nWrite the three-sentence summary and pick the start-here file (must be a real file path from entryPoints or routes).`,
        },
      ],
    });
    if (response.stop_reason === "refusal") return fallbackSummary(map);
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return fallbackSummary(map);
    const parsed = JSON.parse(block.text);
    return {
      text: parsed.summary,
      structure: parsed.structure,
      startHere: { file: parsed.startHereFile, reason: parsed.startHereReason },
      generatedBy: "claude",
    };
  } catch {
    // No credentials, network failure, or malformed output — the map still ships.
    return fallbackSummary(map);
  }
}
