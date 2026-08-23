import Anthropic from "@anthropic-ai/sdk";
import { gradeOverviewAnswer } from "./express";
import { extractFileTokens, fileMatched } from "./match";
import { applyGroundedness, groundedness } from "./grounded";
import { PASS_MARK, type GrillQuestion } from "./types";

export interface GradeResult {
  score: number | null; // null = grading unavailable; excluded from the total
  feedback: string;
}

// ---------- Tier 1: deterministic set grading ----------

export function gradeFileList(answer: string, gtFiles: string[]): GradeResult {
  const hits = gtFiles.filter((f) => fileMatched(answer, f, gtFiles));
  const missed = gtFiles.filter((f) => !fileMatched(answer, f, gtFiles));
  const tokens = extractFileTokens(answer);
  const falsePositives = tokens.filter((t) => !gtFiles.some((f) => fileMatched(t, f) || fileMatched(f, t))).length;

  const recall = hits.length / gtFiles.length;
  const precision = tokens.length > 0 ? Math.min(1, hits.length / Math.max(1, hits.length + falsePositives)) : recall > 0 ? 1 : 0;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const score = Math.round(f1 * 100);

  let feedback = `You named ${hits.length} of ${gtFiles.length} affected files.`;
  // Listing what you missed IS the answer to a blast-radius question, and the
  // interstitial offers to walk you to it right underneath. Below the pass mark
  // the feedback gives a count and a direction and leaves the rest to the
  // ladder; above it, you have shown you know the area, so names are useful.
  if (missed.length > 0) {
    feedback +=
      score >= PASS_MARK
        ? ` Missed: ${missed.slice(0, 5).join(", ")}${missed.length > 5 ? "…" : ""}.`
        : ` ${missed.length} more ${missed.length === 1 ? "is" : "are"} ${areaHint(missed)}.`;
  }
  if (falsePositives > 0) feedback += ` ${falsePositives} file${falsePositives === 1 ? "" : "s"} you named ${falsePositives === 1 ? "isn't" : "aren't"} actually affected.`;
  return { score, feedback };
}

/** Where the misses live, at directory granularity: a direction, not the answer. */
function areaHint(files: string[]): string {
  const roots = [...new Set(files.map((f) => (f.includes("/") ? `${f.split("/")[0]}/` : "the repo root")))];
  if (roots.length === 1) return `in ${roots[0]}`;
  if (roots.length === 2) return `in ${roots[0]} and ${roots[1]}`;
  return `spread across ${roots.length} places`;
}

export function gradeSingleFile(answer: string, file: string): GradeResult {
  const hit = fileMatched(answer, file);
  return {
    score: hit ? 100 : 0,
    // A miss here is exactly one file wide, so there is no partial credit to
    // explain and nothing to say that isn't the answer itself.
    feedback: hit ? "Dead on." : "Not the file this URL maps to.",
  };
}

export function gradeNameSet(answer: string, names: string[], allNames: string[]): GradeResult {
  const a = answer.toLowerCase();
  const hits = names.filter((n) => new RegExp(`\\b${n.toLowerCase()}s?\\b`).test(a));
  const wrong = allNames.filter(
    (n) => !names.includes(n) && new RegExp(`\\b${n.toLowerCase()}s?\\b`).test(a),
  );
  const recall = hits.length / names.length;
  const score = Math.max(0, Math.round(recall * 100 - wrong.length * 15));
  const missed = names.filter((n) => !hits.includes(n));
  let feedback = `You got ${hits.length} of ${names.length} models.`;
  if (missed.length > 0) {
    feedback +=
      score >= PASS_MARK ? ` Missed: ${missed.join(", ")}.` : ` ${missed.length} more to find.`;
  }
  if (wrong.length > 0) feedback += ` ${wrong.join(", ")} ${wrong.length === 1 ? "isn't" : "aren't"} touched by this route.`;
  return { score, feedback };
}

// ---------- Tier 3: LLM groundedness grading ----------

const GRADE_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer", description: "0-100" },
    feedback: { type: "string", description: "One or two blunt sentences. Address the candidate as 'you'." },
  },
  required: ["score", "feedback"],
  additionalProperties: false,
} as const;

export async function gradeSnippetAnswer(
  question: GrillQuestion,
  answer: string,
): Promise<GradeResult> {
  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 512,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: GRADE_SCHEMA },
      },
      system:
        "You grade answers for Third Degree. Grading rule: generic-but-correct must LOSE to specific-and-partial. An answer that names the actual functions and variables involved (the key symbols) and hits the key points scores high; a vague answer that is technically true but could describe any codebase caps at 40. An answer that is wrong about the code scores under 20. Be fair to partial understanding expressed in plain words. Feedback rule: when you score below 60, name what the answer failed to address but never state the correct answer or the missing detail itself — the product then offers to walk the candidate to it, and feedback that gives it away wastes that. At 60 and above you may be explicit.",
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            snippet: question.contextCode,
            question: question.prompt,
            keyPoints: question.groundTruth.keyPoints,
            keySymbols: question.groundTruth.keySymbols,
            correctAnswer: question.groundTruth.reveal,
            candidateAnswer: answer,
          }),
        },
      ],
    });
    if (response.stop_reason === "refusal") {
      return { score: null, feedback: "Couldn't grade this one — it won't count toward your score." };
    }
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error("no text");
    const parsed = JSON.parse(block.text);
    // The model scored the reasoning; the ceiling comes from the code (§5).
    return applyGroundedness(
      Math.max(0, Math.min(100, parsed.score)),
      parsed.feedback,
      groundedness(question, answer),
    );
  } catch {
    return {
      score: null,
      feedback: "Couldn't grade this one (grading model unavailable) — it won't count toward your score.",
    };
  }
}

// ---------- Dispatch ----------

export async function gradeAnswer(
  question: GrillQuestion,
  answer: string,
  allModelNames: string[],
): Promise<GradeResult> {
  const gt = question.groundTruth;
  // Layer 4 carries files, names and hubs at once and is scored without a
  // model in the loop, so it has to be dispatched before the set graders.
  if (question.kind === "overview") return gradeOverviewAnswer(question, answer);
  if (question.kind === "route-handler" && gt.files?.length === 1) {
    return gradeSingleFile(answer, gt.files[0]);
  }
  if (gt.files && gt.files.length > 0) {
    return gradeFileList(answer, gt.files);
  }
  if (gt.names && gt.names.length > 0) {
    return gradeNameSet(answer, gt.names, allModelNames);
  }
  return gradeSnippetAnswer(question, answer);
}
