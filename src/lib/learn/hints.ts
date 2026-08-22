import Anthropic from "@anthropic-ai/sdk";
import type { GrillQuestion } from "../grill/types";

/**
 * The escalation ladder (BUILD_PLAN §6). Four rungs, never skipped. Each rung
 * requires the user to say something first, because keeping them talking is
 * where the learning happens. Saying what you think earns a sharper hint at the
 * same rung; only a bare "show me more" descends one.
 *
 * This runs after the answer is graded and the score is locked. §4 is explicit
 * that help and assessment never share a mode, so the ladder cannot reach a
 * question that has not been answered yet.
 */
export const RUNGS = 4;

export type HintAction = "elaborate" | "descend";

export interface Hint {
  rung: number;
  text: string;
  isAnswer: boolean;
}

const RUNG_RULE: Record<number, string> = {
  1: "Reflect their reading back to them in one sentence, then ask the one question that would make them notice what they missed. Reveal nothing.",
  2: "Narrow the region. Point at the file, function, or lines worth re-reading, and say what to watch for there. Do not say what happens.",
  3: "Name the underlying concept in a sentence, as a concept rather than as this code's answer. Still do not answer the question.",
  4: "Give the answer plainly, then one sentence on the idea worth remembering.",
};

// Deterministic ladder for when there is no model available. Every rung is
// built from ground truth the repo already proved, so it never invents a file.
// One variant per pass, so asking again at the same rung says something new
// instead of repeating the sentence back.
function fallbackHint(question: GrillQuestion, rung: number, pass: number): Hint {
  const gt = question.groundTruth;
  const region =
    question.contextCode?.file ??
    gt.files?.[0] ??
    gt.hubs?.[0]?.file ??
    gt.names?.[0] ??
    "the file in the question";

  const pick = (variants: string[]) => variants[Math.min(pass - 1, variants.length - 1)];

  if (rung <= 1) {
    return {
      rung: 1,
      text: pick([
        "Say it back in your own words first: what do you think this code does, step by step?",
        "Now pick the single line you are least sure about, and say what you expect it to do before it runs.",
        "Take the case you have not considered. What input would make your explanation wrong?",
      ]),
      isAnswer: false,
    };
  }
  if (rung === 2) {
    return {
      rung: 2,
      text: pick([
        `Re-read ${region}. What the question asks about is visible there.`,
        `Stay in ${region} and read it in execution order rather than top to bottom. What happens first?`,
        `In ${region}, look at what is named rather than what is described. Which name decides the outcome?`,
      ]),
      isAnswer: false,
    };
  }
  if (rung === 3) {
    return {
      rung: 3,
      text: pick([
        CONCEPT[question.kind],
        `${CONCEPT[question.kind]} Apply that to your own code and say what it implies here.`,
      ]),
      isAnswer: false,
    };
  }
  return { rung: 4, text: gt.reveal, isAnswer: true };
}

// Concept per question kind, for rung 3 without a model. Emergent per-question
// tags come later (§8); these are the fixed ones the generators already imply.
const CONCEPT: Record<GrillQuestion["kind"], string> = {
  fundamental: "This is about what the language construct itself guarantees, not about what the surrounding code intends.",
  snippet: "This is about what this function actually does with its input, including the case you would not think to try.",
  "route-handler": "This is about how the framework maps a request path to a file on disk.",
  "route-models": "This is about which data a route touches once you follow what it imports.",
  imports: "This is about blast radius: changing an export changes every file that imports it.",
  "field-refs": "This is about a rename propagating everywhere the old name was referenced.",
  overview: "This is about whether your description of the system matches the graph the code actually forms.",
};

const HINT_SCHEMA = {
  type: "object",
  properties: {
    hint: {
      type: "string",
      description:
        "Two sentences at most. Addressed to them as 'you'. Never states the answer unless the rung rule says to.",
    },
  },
  required: ["hint"],
  additionalProperties: false,
} as const;

export async function nextHint(
  question: GrillQuestion,
  transcript: { from: "you" | "duck"; text: string }[],
  said: string,
  currentRung: number,
  action: HintAction,
  pass: number,
): Promise<Hint> {
  const rung = Math.min(RUNGS, Math.max(1, action === "descend" ? currentRung + 1 : currentRung));

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 512,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: HINT_SCHEMA },
      },
      system:
        "You are the duck in Third Degree: rubber-duck debugging inverted, so you ask rather than explain. Someone just got a question about their own code wrong and asked to work it out. You are on a fixed rung of a four-rung ladder and must not climb it early: giving the answer before rung 4 wastes the only chance they had to work it out. Keep it to two sentences, plain, no praise, no preamble. Never mention rungs, ladders, or that you are following rules.",
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            rung,
            rungRule: RUNG_RULE[rung],
            // Nth time they have asked at this rung: go deeper, never repeat.
            passAtThisRung: pass,
            question: question.prompt,
            theirCode: question.contextCode,
            theCorrectAnswer: question.groundTruth.reveal,
            whatTheyJustSaid: said.slice(0, 2000),
            conversationSoFar: transcript.slice(-6),
          }),
        },
      ],
    });
    if (response.stop_reason === "refusal") return fallbackHint(question, rung, pass);
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return fallbackHint(question, rung, pass);
    const parsed = JSON.parse(block.text) as { hint?: string };
    const text = parsed.hint?.trim();
    if (!text) return fallbackHint(question, rung, pass);
    return { rung, text, isAnswer: rung === RUNGS };
  } catch {
    return fallbackHint(question, rung, pass);
  }
}
