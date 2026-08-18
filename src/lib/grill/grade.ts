import Anthropic from "@anthropic-ai/sdk";
import { gradeOverviewAnswer } from "./express";
import { extractFileTokens, fileMatched } from "./match";
import type { GrillQuestion } from "./types";

export interface GradeResult {
  score: number | null; // null = grading unavailable; excluded from the total
  feedback: string;
}

// ---------- Tier 1: deterministic set grading ----------

export function gradeFileList(answer: string, gtFiles: string[]): GradeResult {
  const hits = gtFiles.filter((f) => fileMatched(answer, f));
  const missed = gtFiles.filter((f) => !fileMatched(answer, f));
  const tokens = extractFileTokens(answer);
  const falsePositives = tokens.filter((t) => !gtFiles.some((f) => fileMatched(t, f) || fileMatched(f, t))).length;

  const recall = hits.length / gtFiles.length;
  const precision = tokens.length > 0 ? Math.min(1, hits.length / Math.max(1, hits.length + falsePositives)) : recall > 0 ? 1 : 0;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const score = Math.round(f1 * 100);

  let feedback = `You named ${hits.length} of ${gtFiles.length} affected files.`;
  if (missed.length > 0) feedback += ` Missed: ${missed.slice(0, 5).join(", ")}${missed.length > 5 ? "…" : ""}.`;
  if (falsePositives > 0) feedback += ` ${falsePositives} file${falsePositives === 1 ? "" : "s"} you named ${falsePositives === 1 ? "isn't" : "aren't"} actually affected.`;
  return { score, feedback };
}

export function gradeSingleFile(answer: string, file: string): GradeResult {
  const hit = fileMatched(answer, file);
  return {
    score: hit ? 100 : 0,
    feedback: hit ? "Dead on." : `That request lands in ${file}.`,
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
  if (missed.length > 0) feedback += ` Missed: ${missed.join(", ")}.`;
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
        "You grade answers for Third Degree. Grading rule: generic-but-correct must LOSE to specific-and-partial. An answer that names the actual functions and variables involved (the key symbols) and hits the key points scores high; a vague answer that is technically true but could describe any codebase caps at 40. An answer that is wrong about the code scores under 20. Be fair to partial understanding expressed in plain words.",
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
    return { score: Math.max(0, Math.min(100, parsed.score)), feedback: parsed.feedback };
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
