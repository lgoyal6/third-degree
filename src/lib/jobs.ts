import { randomUUID } from "node:crypto";
import type { CodeMap, MapJob, Stage } from "./types";

// In-memory job store for M0. Survives HMR via globalThis; replaced by a
// queue-fed worker when indexing moves off the request process (see BUILD_PLAN §9).
const JOB_TTL_MS = 30 * 60 * 1000;

const store = (globalThis as unknown as { __tdJobs?: Map<string, MapJob> });
if (!store.__tdJobs) store.__tdJobs = new Map();
const jobs = store.__tdJobs;

function sweep() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.updatedAt > JOB_TTL_MS) jobs.delete(id);
  }
}

export function createJob(url: string): MapJob {
  sweep();
  const job: MapJob = {
    id: randomUUID(),
    url,
    stage: "queued",
    map: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): MapJob | undefined {
  return jobs.get(id);
}

export function updateJob(id: string, stage: Stage, partial?: Partial<CodeMap>): void {
  const job = jobs.get(id);
  if (!job) return;
  job.stage = stage;
  if (partial) job.map = { ...job.map, ...partial };
  job.updatedAt = Date.now();
}

export function failJob(id: string, message: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.stage = "error";
  job.error = message;
  job.updatedAt = Date.now();
}
