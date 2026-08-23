import { after } from "next/server";
import { NextResponse } from "next/server";
import { getJob } from "@/lib/jobs";
import { fetchRepo } from "@/lib/indexer/fetch";
import { walkRepo } from "@/lib/indexer/walk";
import { generateQuestions } from "@/lib/grill/generate";
import { createSession, getSession, saveSession } from "@/lib/grill/store";
import { checkLimit } from "@/lib/ratelimit";
import { sessionToken } from "@/lib/auth/github";
import { normalizeTags } from "@/lib/learn/tags";
import type { GrillQuestion } from "@/lib/grill/types";

// A checkout and a generation pass per repo, in the background.
export const maxDuration = 300;

const MAX_REPOS = 3;
const MAX_QUESTIONS = 12;
const MAX_DUE_TAGS = 12;

/**
 * §10's cram path: "I have an interview Thursday on these 4 repos." One session
 * drawing from several maps, so the switching between codebases is part of the
 * exercise — which is what the interview actually feels like.
 */
async function prepare(sessionId: string, jobIds: string[], token?: string) {
  const session = await getSession(sessionId);
  if (!session) return;
  try {
    const perRepo: GrillQuestion[][] = [];
    for (const jobId of jobIds) {
      const job = await getJob(jobId);
      const meta = job?.map.meta;
      if (!job || !meta) continue;
      // Sequential on purpose: three checkouts and three parses at once is how
      // a background function runs out of memory.
      const { root } = await fetchRepo({ owner: meta.owner, repo: meta.name }, token, job.map.sha);
      const { files } = walkRepo(root);
      const questions = await generateQuestions(root, job.map, files, {
        token,
        dueTags: session.reviewing,
      });
      perRepo.push(questions.map((q) => ({ ...q, repo: `${meta.owner}/${meta.name}` })));
    }
    if (perRepo.every((set) => set.length === 0)) {
      throw new Error("None of those maps produced questions. Map them again and retry.");
    }

    // Round-robin inside each layer: the ladder still climbs, but consecutive
    // questions come from different repos, which is the point of cramming.
    const interleaved: GrillQuestion[] = [];
    for (const layer of [1, 2, 3, 4]) {
      const byRepo = perRepo.map((set) => set.filter((q) => q.layer === layer));
      for (let i = 0; interleaved.length < MAX_QUESTIONS; i++) {
        const round = byRepo.map((set) => set[i]).filter(Boolean);
        if (round.length === 0) break;
        for (const q of round) {
          if (interleaved.length < MAX_QUESTIONS) interleaved.push(q);
        }
      }
    }

    session.questions = interleaved;
    session.modelNames = [...new Set(session.modelNames)];
    session.status = "ready";
    session.askedAt = Date.now();
    await saveSession(session);
  } catch (err) {
    session.status = "error";
    session.error = err instanceof Error ? err.message : "Couldn't build the cram session.";
    await saveSession(session);
  }
}

export async function POST(request: Request) {
  const limited = await checkLimit(request, "cram");
  if (limited) return limited;

  let body: { jobIds?: unknown; mode?: string; dueTags?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const ids = Array.isArray(body.jobIds)
    ? [...new Set(body.jobIds.filter((v): v is string => typeof v === "string"))].slice(0, MAX_REPOS)
    : [];
  if (ids.length < 2) {
    return NextResponse.json({ error: "Pick at least two mapped repos." }, { status: 400 });
  }

  const jobs = (await Promise.all(ids.map((id) => getJob(id)))).filter(
    (job) => job && job.stage === "done" && job.map.meta,
  );
  if (jobs.length < 2) {
    return NextResponse.json(
      { error: "Those maps have expired. Map them again and retry." },
      { status: 400 },
    );
  }

  const first = jobs[0]!;
  const meta = first.map.meta!;
  const session = await createSession({
    status: "preparing",
    // The status line follows each question's own repo on a cram; this is the
    // fallback and the one the share card names.
    repo: {
      owner: meta.owner,
      name: meta.name,
      defaultBranch: meta.defaultBranch,
      description: meta.description,
      private: jobs.some((job) => job!.map.meta?.private),
    },
    frameworks: [...new Set(jobs.flatMap((job) => job!.map.stack?.frameworks ?? []))],
    modelNames: jobs.flatMap((job) => (job!.map.models ?? []).map((m) => m.name)),
    questions: [],
    cram: jobs.map((job) => `${job!.map.meta!.owner}/${job!.map.meta!.name}`),
    mode: body.mode === "defend" ? ("defend" as const) : undefined,
    reviewing: Array.isArray(body.dueTags)
      ? normalizeTags(body.dueTags as (string | null | undefined)[], MAX_DUE_TAGS)
      : undefined,
  });

  const token = await sessionToken();
  after(() => prepare(session.id, jobs.map((job) => job!.id), token));
  return NextResponse.json({ id: session.id });
}
