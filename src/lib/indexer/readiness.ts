import type { CodeMap } from "../types";

/**
 * "How interrogable is this repo" (BUILD_PLAN §5). Deliberately framed that way
 * rather than as a quality score: most early users' repos are thin, and the
 * first impression must never read as an insult. Every component is measured
 * from the map, so the number is explainable line by line rather than a vibe.
 */
export interface Readiness {
  score: number; // 0-100
  label: "thin" | "workable" | "interrogable" | "deep";
  parts: { surface: number; structure: number; wiring: number; depth: number };
}

const CODE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function share(value: number, full: number, cap: number): number {
  if (full <= 0) return 0;
  return Math.max(0, Math.min(cap, Math.round((value / full) * cap)));
}

export function readinessOf(map: CodeMap): Readiness {
  // The language breakdown is on every map; filePaths was added later and is
  // capped, so it is the fallback rather than the source.
  const counted = (map.languages ?? [])
    .filter((l) => ["TypeScript", "JavaScript", "Vue", "Svelte", "Python", "Go", "Ruby"].includes(l.name))
    .reduce((sum, l) => sum + l.files, 0);
  const codeFiles = counted || (map.filePaths ?? []).filter((p) => CODE.test(p)).length;
  const routes = (map.routes ?? []).length;
  const models = (map.models ?? []).length;
  const edges = map.graph?.edges.length ?? 0;
  const loc = map.totalLoc ?? 0;

  const parts = {
    // Enough files that questions are not all about the same three.
    surface: share(codeFiles, 40, 25),
    // Routes and models are what Layers 2 and 3 are made of.
    structure: share(routes, 8, 12) + share(models, 5, 13),
    // Imports between files are the seams; a flat repo has none to ask about.
    wiring: share(edges, 120, 25),
    depth: share(loc, 8_000, 25),
  };
  const score = Math.min(100, parts.surface + parts.structure + parts.wiring + parts.depth);

  return {
    score,
    label: score >= 80 ? "deep" : score >= 55 ? "interrogable" : score >= 30 ? "workable" : "thin",
    parts,
  };
}
