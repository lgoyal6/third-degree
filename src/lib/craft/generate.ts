import { readFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { CodeMap, CraftItem } from "../types";
import type { FileEntry } from "../indexer/walk";

/**
 * Layer 5, the "I didn't know that existed" layer (BUILD_PLAN §3): concrete
 * upgrades to what they built, each one a diff against their code rather than
 * advice. §10a is explicit that we show the diff and let them apply it, so
 * nothing here writes to the repo.
 *
 * The hard rule is that `before` must exist verbatim in their file. A model
 * asked for a diff will happily invent the code it is improving; an item whose
 * before-block cannot be found is dropped rather than shown, the same way
 * Layer 4's phantom files are.
 */

const MAX_ITEMS = 6;
const MAX_FILE_LINES = 320;
const CODE = /\.(tsx|ts|jsx|js)$/;

const CRAFT_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: ["ui", "accessibility", "states", "hardening"],
            description:
              "ui: a technique that makes the interface feel considered, including the words a user reads. accessibility: keyboard, focus order, labels and roles, contrast, reduced motion — the things assistive technology depends on, not wording. states: loading, empty, error, offline. hardening: what breaks in production — validation, limits, timeouts, leaks.",
          },
          file: { type: "string", description: "Repo-relative path, exactly as given." },
          before: {
            type: "string",
            description:
              "The lines you are replacing, copied CHARACTER FOR CHARACTER from the file including its indentation, with the line numbers stripped. Two to twelve lines. If you cannot copy it exactly, do not propose the item.",
          },
          after: {
            type: "string",
            description:
              "Those lines rewritten, in the same style and indentation as the surrounding file. Real code, complete enough to paste, no ellipses and no placeholder comments.",
          },
          rationale: {
            type: "string",
            description:
              "One or two sentences: what this fixes for a real user, in their words, not the name of the technique.",
          },
        },
        required: ["category", "file", "before", "after", "rationale"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;

function read(root: string, rel: string): string {
  try {
    return readFileSync(path.join(root, rel), "utf8");
  } catch {
    return "";
  }
}

/** Whitespace-tolerant search, so indentation drift does not lose a real match. */
function findBlock(fileText: string, before: string): number {
  const lines = fileText.split("\n");
  const needle = before.split("\n").map((l) => l.trim()).filter(Boolean);
  if (needle.length === 0) return -1;
  for (let i = 0; i + needle.length <= lines.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (lines[i + j].trim() !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i + 1; // 1-indexed
  }
  return -1;
}

/**
 * Three files, chosen so the categories have somewhere to land: something the
 * user looks at, something that answers a request, and something that talks to
 * the data.
 */
function targets(map: CodeMap, files: FileEntry[]): string[] {
  const code = files.filter(
    (f) =>
      CODE.test(f.path) &&
      f.loc >= 20 &&
      f.loc <= MAX_FILE_LINES &&
      !/\.(test|spec|stories|d)\./.test(f.path) &&
      !/(^|\/)(components\/ui|node_modules)\//.test(f.path),
  );
  const pick = (re: RegExp) =>
    code
      .filter((f) => re.test(f.path))
      .sort((a, b) => b.loc - a.loc)
      .map((f) => f.path)[0];

  const chosen = [
    pick(/\.(tsx|jsx)$/),
    pick(/(^|\/)(app|pages)\/.*(route|api)/) ?? pick(/(^|\/)(server|api)\//),
    pick(/(^|\/)(lib|server|db|services)\//),
    ...(map.entryPoints ?? []),
  ].filter((p): p is string => Boolean(p));

  return [...new Set(chosen)].slice(0, 4);
}

export async function generateCraft(
  root: string,
  map: CodeMap,
  files: FileEntry[],
): Promise<CraftItem[]> {
  const chosen = targets(map, files);
  if (chosen.length === 0) return [];

  const shown = chosen
    .map((file) => {
      const text = read(root, file);
      if (!text) return null;
      const numbered = text
        .split("\n")
        .slice(0, MAX_FILE_LINES)
        .map((line, i) => `${i + 1}: ${line}`)
        .join("\n");
      return `--- ${file} ---\n${numbered}`;
    })
    .filter(Boolean)
    .join("\n\n");
  if (!shown) return [];

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4096,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: CRAFT_SCHEMA },
      },
      system:
        "You are the craft reviewer in Third Degree. The developer shipped this code, probably with an AI's help, and it works. Your job is the upgrade they did not know to ask for: the technique, the accessibility fix, the empty state, the production guard that separates a demo from something people use. Each item is a diff against a real block of their code, so copy the before-block exactly as it appears and write an after-block they could paste. No lectures, no renaming things for taste, no 'consider extracting a hook'. Prefer three specific upgrades over six vague ones, and never propose a change to code you were not shown.",
      messages: [
        {
          role: "user",
          content: `${shown}\n\nStack: ${(map.stack?.frameworks ?? []).join(", ") || "unknown"}.`,
        },
      ],
    });
    if (response.stop_reason === "refusal") return [];
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return [];
    const parsed = JSON.parse(block.text) as { items: Omit<CraftItem, "startLine">[] };

    const out: CraftItem[] = [];
    for (const item of parsed.items ?? []) {
      if (!chosen.includes(item.file)) continue; // not a file we showed it
      const startLine = findBlock(read(root, item.file), item.before);
      if (startLine === -1) continue; // the before-block is not really there
      if (!item.after?.trim() || item.after.trim() === item.before.trim()) continue;
      out.push({ ...item, startLine });
      if (out.length >= MAX_ITEMS) break;
    }
    return out;
  } catch {
    // No credentials or a failed call: the screen says so rather than inventing
    // upgrades, since an invented diff against real code is worse than none.
    return [];
  }
}
