/**
 * Defend mode's clock (BUILD_PLAN §4): timed, unassisted, recorded. The limit
 * is enforced on the server from the moment the question was served, because a
 * countdown the client owns is a countdown the client can pause.
 *
 * "Recorded" here means the transcript: every question, what they said, how
 * long it took, and what it scored. That is the artifact the share link shows.
 */
const BY_LAYER: Record<number, number> = {
  1: 90_000, // read a snippet, say what it does
  2: 90_000, // where does this request land
  3: 120_000, // blast radius, which needs thinking about the tree
  4: 180_000, // design defence under pressure
};

/** Late by less than this is the network, not the candidate. */
export const GRACE_MS = 4_000;

export function limitFor(layer: number): number {
  return BY_LAYER[layer] ?? 120_000;
}
