import { limitFor } from "./defend";
import type { GrillSession } from "./types";

// The wire shape sent to the client. Ground truth for unanswered questions
// must never leave the server.
export interface GrillView {
  id: string;
  slug: string;
  status: GrillSession["status"];
  mode: "grill" | "learn" | "defend";
  jobId?: string;
  /** Defend only: when the live question was served, and how long they get. */
  askedAt?: number;
  limitMs?: number;
  /** Server clock, so a client with a skewed one still counts down correctly. */
  now: number;
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
    /** Time on the clock for this answer, which the recording shows. */
    latencyMs: number;
    timedOut?: boolean;
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
    mode: session.mode ?? "grill",
    jobId: session.jobId,
    now: Date.now(),
    askedAt: session.mode === "defend" ? session.askedAt : undefined,
    limitMs: session.mode === "defend" && current ? limitFor(current.layer) : undefined,
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
    // Sliced at the cursor: a Learn retry leaves a graded attempt sitting on a
    // question that is still live, and every answered entry carries its reveal.
    answered: session.attempts.slice(0, session.currentIndex).map((a, i) => {
      const question = session.questions[i];
      // Defend says nothing until the session is over: mid-recording, the
      // client gets the transcript of what was asked and said, and no marks.
      const sealed = session.mode === "defend" && !finished;
      return {
        id: question?.id ?? "",
        prompt: question?.prompt ?? "",
        // Only on answered questions — on a live one a tag can restate the answer.
        conceptTags: sealed ? [] : question?.conceptTags ?? [],
        layer: question?.layer ?? 1,
        answer: a.answer,
        score: sealed ? null : a.score,
        feedback: sealed ? "" : a.feedback,
        reveal: sealed ? "" : question?.groundTruth.reveal ?? "",
        latencyMs: a.latencyMs,
        timedOut: a.timedOut,
      };
    }),
  };
}
