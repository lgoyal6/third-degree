export type QuestionKind =
  | "fundamental" // Layer 1 — language/DSA construct in their actual code
  | "snippet" // Layer 1 — behavior of a real function they shipped
  | "route-handler" // Layer 2 — which file handles this request
  | "route-models" // Layer 2 — which models does this route touch
  | "imports" // Layer 3 — blast radius via import graph
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
}

export interface Attempt {
  questionId: string;
  answer: string;
  score: number | null; // null = grading unavailable, excluded from total
  feedback: string;
  latencyMs: number;
}

export type Verdict = "raw" | "rare" | "medium" | "well-done";

export interface GrillSession {
  id: string;
  slug: string;
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
