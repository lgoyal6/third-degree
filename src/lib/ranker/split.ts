import type { AttemptRow } from "./dataset";
import { coldContext, featuresOf, type FeatureContext, type KindStat } from "./features";

/**
 * Prequential example building and leakage-safe splits.
 *
 * Features for a session are computed only from events that happened strictly
 * before that session started - the information the product could actually
 * have had at serve time. Splits hold out whole evaluation units (sessions,
 * or repositories) and a detector fails hard when a unit or the time
 * ordering leaks.
 */

export interface Example {
  row: AttemptRow;
  features: number[];
  /** 1 = missed, 0 = passed, null = grading was unavailable (never a label). */
  y: number | null;
}

export interface SessionGroup {
  session: string;
  repo: string;
  t: number;
  examples: Example[];
}

interface RepoHistory {
  layerStats: Record<number, { attempts: number; passes: number }>;
  attempts: number;
  sessions: number;
  finishedSessions: number;
  lastT: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Walks the dataset in time order, emitting one group per session whose
 * features are built from the history snapshot taken before that session.
 */
export function buildExamples(rows: AttemptRow[]): SessionGroup[] {
  const ordered = [...rows].sort(
    (a, b) => a.t - b.t || a.session.localeCompare(b.session) || a.position - b.position,
  );

  const kindStats: Record<string, KindStat> = {};
  let labeledAttempts = 0;
  let labeledMisses = 0;
  const repoHistory = new Map<string, RepoHistory>();

  const groups: SessionGroup[] = [];
  let i = 0;
  while (i < ordered.length) {
    const first = ordered[i];
    const sessionRows: AttemptRow[] = [];
    while (i < ordered.length && ordered[i].session === first.session) sessionRows.push(ordered[i++]);

    const repo = repoHistory.get(first.repo) ?? {
      layerStats: {},
      attempts: 0,
      sessions: 0,
      finishedSessions: 0,
      lastT: null,
    };

    // Snapshot before this session: nothing it contains informs its own features.
    const ctx: FeatureContext = {
      ...coldContext(
        structuredClone(kindStats),
        labeledAttempts > 0 ? labeledMisses / labeledAttempts : 0.5,
        first.due,
      ),
      layerStats: structuredClone(repo.layerStats),
      repoAttempts: repo.attempts,
      repoSessions: repo.sessions,
      repoFinishedSessions: repo.finishedSessions,
      daysSinceLastAttempt: repo.lastT === null ? null : (first.t - repo.lastT) / DAY_MS,
    };

    groups.push({
      session: first.session,
      repo: first.repo,
      t: first.t,
      examples: sessionRows.map((row) => ({
        row,
        features: featuresOf(
          { kind: row.kind, layer: row.layer, gradingTier: row.tier, conceptTags: row.tags },
          ctx,
        ),
        y: row.missed === null ? null : row.missed ? 1 : 0,
      })),
    });

    // Now fold the session into history for everything that comes after it.
    for (const row of sessionRows) {
      repo.attempts++;
      if (row.missed !== null) {
        const kind = (kindStats[row.kind] ??= { attempts: 0, misses: 0 });
        kind.attempts++;
        if (row.missed) kind.misses++;
        labeledAttempts++;
        if (row.missed) labeledMisses++;
        const layer = (repo.layerStats[row.layer] ??= { attempts: 0, passes: 0 });
        layer.attempts++;
        if (!row.missed) layer.passes++;
      }
    }
    repo.sessions++;
    if (sessionRows.some((r) => r.finished)) repo.finishedSessions++;
    repo.lastT = first.t;
    repoHistory.set(first.repo, repo);
  }
  return groups;
}

export interface Split {
  name: string;
  train: SessionGroup[];
  eval: SessionGroup[];
  /** What must never appear on both sides. */
  unitOf: (g: SessionGroup) => string;
}

/** Session-unit split: everything before the cutoff trains, the rest evaluates. */
export function primarySplit(groups: SessionGroup[], cutoffMs: number): Split {
  return {
    name: `primary (session + time, cutoff ${new Date(cutoffMs).toISOString()})`,
    train: groups.filter((g) => g.t < cutoffMs),
    eval: groups.filter((g) => g.t >= cutoffMs),
    unitOf: (g) => g.session,
  };
}

/**
 * Repo-holdout slices: one per evaluation repo. None of the holdout repos is
 * ever trained on, and training stops before the holdout repo's first event.
 */
export function repoSlices(groups: SessionGroup[], evalRepos: string[]): Split[] {
  const banned = new Set(evalRepos);
  return evalRepos
    .map((repo) => {
      const evalGroups = groups.filter((g) => g.repo === repo);
      if (evalGroups.length === 0) return null;
      const firstT = Math.min(...evalGroups.map((g) => g.t));
      return {
        name: `repo holdout (${repo})`,
        train: groups.filter((g) => !banned.has(g.repo) && g.t < firstT),
        eval: evalGroups,
        unitOf: (g: SessionGroup) => g.repo,
      };
    })
    .filter((s): s is Split => s !== null);
}

/**
 * The leakage detector. Throws when an evaluation unit appears in training,
 * when a session shows up on both sides under any unit definition, or when a
 * training session does not strictly precede every evaluation session.
 */
export function assertNoLeakage(split: Split): void {
  const trainUnits = new Set(split.train.map(split.unitOf));
  for (const g of split.eval) {
    if (trainUnits.has(split.unitOf(g))) {
      throw new Error(`Leakage in ${split.name}: evaluation unit "${split.unitOf(g)}" appears in training.`);
    }
  }
  const trainSessions = new Set(split.train.map((g) => g.session));
  for (const g of split.eval) {
    if (trainSessions.has(g.session)) {
      throw new Error(`Leakage in ${split.name}: session "${g.session}" appears on both sides.`);
    }
  }
  if (split.train.length > 0 && split.eval.length > 0) {
    const lastTrain = Math.max(...split.train.map((g) => g.t));
    const firstEval = Math.min(...split.eval.map((g) => g.t));
    if (lastTrain >= firstEval) {
      throw new Error(
        `Leakage in ${split.name}: training reaches ${new Date(lastTrain).toISOString()}, ` +
          `evaluation starts ${new Date(firstEval).toISOString()}.`,
      );
    }
  }
}

export function labeledExamples(groups: SessionGroup[]): { X: number[][]; y: number[]; rows: AttemptRow[] } {
  const X: number[][] = [];
  const y: number[] = [];
  const rows: AttemptRow[] = [];
  for (const g of groups) {
    for (const ex of g.examples) {
      if (ex.y === null) continue;
      X.push(ex.features);
      y.push(ex.y);
      rows.push(ex.row);
    }
  }
  return { X, y, rows };
}
