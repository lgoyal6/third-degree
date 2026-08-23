import type { GrillSession } from "./types";

// The wire shape sent to the client. Ground truth for unanswered questions
// must never leave the server.
export interface GrillView {
  id: string;
  slug: string;
  status: GrillSession["status"];
  error?: string;
  repo: GrillSession["repo"];
  frameworks: string[];
  total: number;
  currentIndex: number;
  finished: boolean;
  score?: number;
  verdict?: GrillSession["verdict"];
  question: {
    id: string;
    layer: number;
    kind: string;
    prompt: string;
    contextCode?: { file: string; code: string; startLine: number };
  } | null;
  answered: {
    id: string;
    prompt: string;
    conceptTags: string[];
    layer: number;
    answer: string;
    score: number | null;
    feedback: string;
    reveal: string;
  }[];
}

export function publicView(session: GrillSession): GrillView {
  const finished = session.finishedAt !== undefined;
  const current =
    !finished && session.status === "ready" ? session.questions[session.currentIndex] ?? null : null;

  return {
    id: session.id,
    slug: session.slug,
    status: session.status,
    error: session.error,
    repo: session.repo,
    frameworks: session.frameworks,
    total: session.questions.length,
    currentIndex: session.currentIndex,
    finished,
    score: session.score,
    verdict: session.verdict,
    question: current
      ? {
          id: current.id,
          layer: current.layer,
          kind: current.kind,
          prompt: current.prompt,
          contextCode: current.contextCode,
        }
      : null,
    answered: session.attempts.map((a, i) => {
      const question = session.questions[i];
      return {
        id: question?.id ?? "",
        prompt: question?.prompt ?? "",
        // Only on answered questions — on a live one a tag can restate the answer.
        conceptTags: question?.conceptTags ?? [],
        layer: question?.layer ?? 1,
        answer: a.answer,
        score: a.score,
        feedback: a.feedback,
        reveal: question?.groundTruth.reveal ?? "",
      };
    }),
  };
}
