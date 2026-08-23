import type { GrillQuestion } from "./types";

/**
 * Deterministic groundedness for open-ended answers (BUILD_PLAN §5 Tier 3):
 * "generic-but-correct must lose to specific-and-partial." The model judges
 * whether the reasoning is right; what the answer is actually *about* is
 * measured here, against the symbols the code contains, so the incentive is
 * mechanical rather than a line in a prompt the model may soften.
 */

export interface Groundedness {
  /** Key symbols for this question that the answer names. */
  relevant: string[];
  /** Other identifiers from the snippet the answer names: specific, if not central. */
  specific: string[];
  /** The ceiling this earns, per §5's caps. */
  ceiling: number;
  /** Set when the ceiling actually bit, for the feedback line. */
  note?: string;
}

// Nothing here distinguishes one codebase from another.
const NOISE = new Set([
  "const", "await", "async", "function", "return", "export", "import", "from", "this",
  "type", "interface", "class", "extends", "implements", "default", "null", "undefined",
  "true", "false", "void", "never", "unknown", "string", "number", "boolean", "object",
  "promise", "record", "array", "json", "math", "date", "error", "throw", "catch", "finally",
  "while", "break", "continue", "switch", "case", "else", "then", "with", "params", "props",
  "value", "values", "result", "data", "item", "items", "index", "length", "push", "map",
  "filter", "reduce", "foreach", "keys", "entries", "console", "window", "document",
]);

const IDENT = /[A-Za-z_$][A-Za-z0-9_$]{3,}/g;

function identifiers(code: string): string[] {
  const out = new Set<string>();
  for (const raw of code.match(IDENT) ?? []) {
    const token = raw.toLowerCase();
    if (NOISE.has(token)) continue;
    out.add(raw);
  }
  return [...out];
}

// Short symbols collide with ordinary English — `Set`, `Map`, `has` — so they
// only count when the case matches too. Anything longer is generous about case,
// since people retype symbols from memory.
const CASE_SENSITIVE_BELOW = 5;

function names(answer: string, candidates: string[]): string[] {
  return candidates.filter((symbol) => {
    const strict = symbol.length < CASE_SENSITIVE_BELOW;
    const haystack = strict ? answer : answer.toLowerCase();
    const needle = strict ? symbol : symbol.toLowerCase();
    let at = haystack.indexOf(needle);
    while (at !== -1) {
      const before = at === 0 ? "" : haystack[at - 1];
      const after = haystack[at + needle.length] ?? "";
      if (!/[A-Za-z0-9_$]/.test(before) && !/[A-Za-z0-9_$]/.test(after)) return true;
      at = haystack.indexOf(needle, at + 1);
    }
    return false;
  });
}

export function groundedness(question: GrillQuestion, answer: string): Groundedness {
  const keySymbols = question.groundTruth.keySymbols ?? [];
  const inCode = question.contextCode ? identifiers(question.contextCode.code) : [];
  const relevant = names(answer, keySymbols);
  const specific = names(
    answer,
    inCode.filter((i) => !keySymbols.some((k) => k.toLowerCase() === i.toLowerCase())),
  );

  if (relevant.length > 0) return { relevant, specific, ceiling: 100 };
  if (specific.length > 0) {
    return {
      relevant,
      specific,
      ceiling: 70,
      note: "You stayed on real code but never got to the part the question turns on.",
    };
  }
  return {
    relevant,
    specific,
    // §5's cap for an answer that is technically true and could describe any
    // codebase: it names nothing that exists in front of it.
    ceiling: 40,
    note: "Nothing in that answer names anything in the code, so it would read the same about any repo.",
  };
}

/** Applies the ceiling, and says why when it bites. */
export function applyGroundedness(
  score: number,
  feedback: string,
  g: Groundedness,
): { score: number; feedback: string } {
  if (score <= g.ceiling) return { score, feedback };
  return { score: g.ceiling, feedback: g.note ? `${feedback} ${g.note}` : feedback };
}
