import { after } from "next/server";
import { NextResponse } from "next/server";
import { getJob } from "@/lib/jobs";
import { fetchRepo } from "@/lib/indexer/fetch";
import { walkRepo } from "@/lib/indexer/walk";
import { generateQuestions } from "@/lib/grill/generate";
import { createSession, getSession, saveSession } from "@/lib/grill/store";
import { checkLimit } from "@/lib/ratelimit";
import { currentSession } from "@/lib/auth/github";
import { normalizeTags } from "@/lib/learn/tags";
import { loadRankerModel } from "@/lib/ranker/artifact";
import { assignArm, EXPERIMENT, logExposure, unitHash } from "@/lib/ranker/experiment";
import type { TrainedModel } from "@/lib/ranker/model";

// Enough to carry a real backlog, few enough that the prompt stays a prompt.
const MAX_DUE_TAGS = 12;

// Question generation continues in `after()` once the response is sent.
export const maxDuration = 300;

async function prepare(
  sessionId: string,
  ref: { owner: string; repo: string },
  mapJobId: string,
  userToken?: string,
  rankModel?: TrainedModel,
) {
  const [session, job] = await Promise.all([getSession(sessionId), getJob(mapJobId)]);
  if (!session || !job) return;
  try {
    // Pinned to the commit the map was indexed from, so the questions are
    // generated against the same tree the map describes. Warm instances already
    // have that commit extracted; otherwise this re-downloads it.
    const { root } = await fetchRepo(ref, userToken, job.map.sha);
    const { files } = walkRepo(root);
    session.questions = await generateQuestions(root, job.map, files, {
      token: userToken,
      dueTags: session.reviewing,
      rankModel,
    });
    session.status = "ready";
    // Defend's clock starts when there is something to answer, not when the
    // request was made: question generation is not their time to lose.
    session.askedAt = Date.now();
    await saveSession(session);
  } catch (err) {
    session.status = "error";
    session.error = err instanceof Error ? err.message : "Couldn't build the grilling.";
    await saveSession(session);
  }
}

export async function POST(request: Request) {
  const limited = await checkLimit(request, "grill");
  if (limited) return limited;

  let body: { jobId?: string; mode?: string; dueTags?: unknown; clientId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const job = body.jobId ? await getJob(body.jobId) : undefined;
  if (!job || job.stage !== "done" || !job.map.meta) {
    return NextResponse.json({ error: "Map not ready — build the map first." }, { status: 400 });
  }

  const meta = job.map.meta;

  // Ranking holdout: deterministic arm per unit. Unit preference: signed-in
  // GitHub id, then the browser's stable anonymous id, then a per-session id
  // (weakest, but it keeps one session internally consistent). Raw ids are
  // hashed before they touch storage.
  const gh = await currentSession();
  const clientId =
    typeof body.clientId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(body.clientId)
      ? body.clientId
      : undefined;
  const [unitId, unitSource] = gh?.userId
    ? ([gh.userId, "github"] as const)
    : clientId
      ? ([clientId, "client"] as const)
      : ([crypto.randomUUID(), "session"] as const);
  const arm = assignArm(unitId);

  const session = await createSession({
    status: "preparing",
    repo: {
      owner: meta.owner,
      name: meta.name,
      defaultBranch: meta.defaultBranch,
      description: meta.description,
      private: meta.private,
    },
    jobId: job.id,
    mode:
      body.mode === "learn"
        ? ("learn" as const)
        : body.mode === "defend"
          ? ("defend" as const)
          : undefined,
    // Concepts the browser says are due (§6 resurfacing). The queue lives on
    // the client until identity does, so this arrives with the request rather
    // than being read server-side.
    reviewing: Array.isArray(body.dueTags)
      ? normalizeTags(body.dueTags as (string | null | undefined)[], MAX_DUE_TAGS)
      : undefined,
    exp: { experiment: EXPERIMENT, arm, unit: unitHash(unitId), unitSource },
    frameworks: job.map.stack?.frameworks ?? [],
    modelNames: (job.map.models ?? []).map((m) => m.name),
    questions: [],
  });

  const rankModel = arm === "learned" ? loadRankerModel() : undefined;
  after(async () => {
    await logExposure({
      t: Date.now(),
      experiment: EXPERIMENT,
      arm,
      unit: unitHash(unitId),
      unitSource,
      sessionId: session.id,
      modelVersion: rankModel?.version,
    });
    await prepare(session.id, { owner: meta.owner, repo: meta.name }, job.id, gh?.token, rankModel);
  });
  return NextResponse.json({ id: session.id });
}
