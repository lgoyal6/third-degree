export type QuestionKind =
  | "fundamental" // Layer 1 — language/DSA construct in their actual code
  | "snippet" // Layer 1 — behavior of a real function they shipped
  | "route-handler" // Layer 2 — which file handles this request
  | "route-models" // Layer 2 — which models does this route touch
  | "imports" // Layer 3 — blast radius via import graph
  | "call-sites" // Layer 3 — blast radius of one symbol, via the reference graph
  | "commit-scope" // Layer 3 — which files a described change touched, from history
  | "scale" // Layer 4 — pressure applied to a hot path the AST found
  | "field-refs" // Layer 3 — blast radius of a schema field rename
  | "overview"; // Layer 4 — describe the whole system, scored on groundedness

export interface ContextCode {
  file: string;
  code: string;
  startLine: number;
}

export interface GroundTruth {
  files?: string[]; // graded by set overlap
  names?: string[]; // graded by name-set overlap
  hubs?: { file: string; weight: number }[]; // load-bearing files, weighted by import degree
  filePaths?: string[]; // every path the walk found, so invented files can be caught
  keyPoints?: string[]; // LLM-graded
  keySymbols?: string[]; // LLM-graded groundedness anchors
  reveal: string; // human-readable correct answer shown after grading
}

export interface GrillQuestion {
  id: string;
  layer: 1 | 2 | 3 | 4;
  kind: QuestionKind;
  prompt: string;
  contextCode?: ContextCode;
  groundTruth: GroundTruth;
  gradingTier: 1 | 3;
  conceptTags?: string[]; // emergent, free-form (BUILD_PLAN §8)
  /** owner/name, set only on cram sessions, which span repos. */
  repo?: string;
}

export interface Attempt {
  questionId: string;
  answer: string;
  /** Answers given to this question. Only Learn mode allows more than one. */
  tries?: number;
  /** Defend only: the clock ran out before this answer landed. */
  timedOut?: boolean;
  score: number | null; // null = grading unavailable, excluded from total
  feedback: string;
  latencyMs: number;
  hintsUsed?: number; // rungs of the §6 ladder taken after the score was locked
}

export type Verdict = "raw" | "rare" | "medium" | "well-done";

export interface GrillSession {
  id: string;
  slug: string;
  /**
   * §4's modes. Absent means grill, so sessions created before the others
   * existed keep working. Grill is assessment-lite: clock on, no help, share
   * card. Learn is the retention half: companion on, hints on the live
   * question, a second try at a miss, and no share card. Defend is the
   * endgame: a server-side clock per question, no help of any kind, and
   * nothing revealed until the recording at the end.
   */
  mode?: "learn" | "defend";
  /** When the live question was served. Defend's clock runs from here. */
  askedAt?: number;
  /** The map this session was built from, so the verdict can link on to Craft. */
  jobId?: string;
  /** §10's cram path: the maps this session draws from, when it is more than one. */
  cram?: string[];
  /** Concepts the review queue asked to see again when this session started. */
  reviewing?: string[];
  /**
   * Ladder rungs taken on a question before answering it, by question id. Only
   * Learn mode can produce these, and they are folded into the attempt's
   * hintsUsed when the answer finally lands.
   */
  hintsAhead?: Record<string, number>;
  status: "preparing" | "ready" | "error";
  error?: string;
  repo: {
    owner: string;
    name: string;
    defaultBranch: string;
    description: string | null;
    // Private repos never get a public verdict page: the questions carry real
    // file paths, so a share link would leak the tree to anyone holding it.
    private?: boolean;
  };
  frameworks: string[];
  modelNames: string[]; // all data-model names, for wrong-model penalties in grading
  questions: GrillQuestion[];
  attempts: Attempt[];
  currentIndex: number;
  score?: number;
  verdict?: Verdict;
  finishedAt?: number;
  createdAt: number;
}

/**
 * The passing band, shared by the grader, the on-ramp trigger and the review
 * queue. It lived as a literal 60 in all three, which is how the graders ended
 * up revealing answers on questions the on-ramp was about to offer to teach.
 */
export const PASS_MARK = 60;

export function verdictFor(score: number): Verdict {
  if (score >= 80) return "well-done";
  if (score >= 60) return "medium";
  if (score >= 40) return "rare";
  return "raw";
}

export const VERDICT_COPY: Record<Verdict, string> = {
  raw: "You shipped code you can't explain.",
  rare: "You'd sweat in the interview.",
  medium: "Solid, with soft spots.",
  "well-done": "You actually own this repo.",
};
