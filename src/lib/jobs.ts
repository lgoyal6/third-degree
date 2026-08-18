import { randomUUID } from "node:crypto";
import { redis } from "./redis";
import type { CodeMap, MapJob, Stage } from "./types";

// Map jobs are throwaway progress state: the client polls until "done", then
// works from the rendered map. Serverless instances don't share memory, so this
// lives in Redis (BUILD_PLAN §9) — the poll may land on a different instance
// than the one indexing.
const JOB_TTL_SECONDS = 30 * 60;

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
