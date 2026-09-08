import { createHash } from "node:crypto";
import { redis } from "../redis";

/**
 * Deterministic assignment for the ranking holdout, and exposure logging so an
 * online readout is possible once real traffic exists. No online claim is made
 * anywhere: nothing has been assigned yet, and the readout code deliberately
 * does not exist until there is something honest to read.
 */

export type Arm = "baseline" | "learned";

export const EXPERIMENT = "grill-ranking-v1";
const EVENTS_KEY = `exp:${EXPERIMENT}`;
const EVENTS_CAP = 5000;

/** FNV-1a over salt:unit - stable across processes, deploys, and runtimes. */
function fnv1a(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * The same unit always lands in the same arm. Unit preference at the call
 * site: signed-in GitHub user id, then the browser's stable anonymous id,
 * then the session id (weakest - it randomizes per session and is logged as
 * such, but it keeps one session internally consistent).
 */
export function assignArm(unitId: string, experiment = EXPERIMENT): Arm {
  return fnv1a(`${experiment}:${unitId}`) % 100 < 50 ? "baseline" : "learned";
}

/** Units are logged hashed; raw ids never enter the event stream. */
export function unitHash(unitId: string): string {
  return createHash("sha256").update(unitId, "utf8").digest("hex").slice(0, 12);
}

export interface ExposureEvent {
  t: number;
  experiment: string;
  arm: Arm;
  unit: string; // hashed
  unitSource: "github" | "client" | "session";
  sessionId: string;
  modelVersion?: string;
}

/** Fire-and-forget: the experiment must never be able to break a session. */
export async function logExposure(event: ExposureEvent): Promise<void> {
  try {
    await redis()
      .pipeline()
      .lpush(EVENTS_KEY, JSON.stringify(event))
      .ltrim(EVENTS_KEY, 0, EVENTS_CAP - 1)
      .exec();
  } catch {
    // storage unavailable: the session goes on, the exposure is just unlogged
  }
}
