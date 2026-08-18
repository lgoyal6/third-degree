import { randomUUID } from "node:crypto";
import { redis } from "./redis";
import type { CodeMap, MapJob, Stage } from "./types";

// Serverless instances don't share memory, so jobs live in Redis (BUILD_PLAN §9):
// a poll may land on a different instance than the one indexing.
// The TTL is a week rather than minutes because a map URL is a resumable
// artifact, not just progress state. Skipping the lesson deck and coming back
// later has to still work.
const JOB_TTL_SECONDS = 7 * 24 * 60 * 60;

const key = (id: string) => `job:${id}`;

export async function createJob(url: string): Promise<MapJob> {
  const job: MapJob = {
    id: randomUUID(),
    url,
    stage: "queued",
    map: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await redis().set(key(job.id), job, { ex: JOB_TTL_SECONDS });
  return job;
}

export async function getJob(id: string): Promise<MapJob | undefined> {
  const job = await redis().get<MapJob>(key(id));
  return job ?? undefined;
}

export async function updateJob(
  id: string,
  stage: Stage,
  partial?: Partial<CodeMap>,
): Promise<void> {
  const job = await getJob(id);
  if (!job) return;
  job.stage = stage;
  if (partial) job.map = { ...job.map, ...partial };
  job.updatedAt = Date.now();
  await redis().set(key(id), job, { ex: JOB_TTL_SECONDS });
}

export async function failJob(id: string, message: string): Promise<void> {
  const job = await getJob(id);
  if (!job) return;
  job.stage = "error";
  job.error = message;
  job.updatedAt = Date.now();
  await redis().set(key(id), job, { ex: JOB_TTL_SECONDS });
}
