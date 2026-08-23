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

// Enough to carry a real backlog, few enough that the prompt stays a prompt.
const MAX_DUE_TAGS = 12;

// Question generation continues in `after()` once the response is sent.
export const maxDuration = 300;

async function prepare(
  sessionId: string,
  ref: { owner: string; repo: string },
  mapJobId: string,
  userToken?: string,
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
    });
    session.status = "ready";
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

  let body: { jobId?: string; mode?: string; dueTags?: unknown };
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
  const session = await createSession({
    status: "preparing",
    repo: {
      owner: meta.owner,
      name: meta.name,
      defaultBranch: meta.defaultBranch,
      description: meta.description,
      private: meta.private,
    },
    mode: body.mode === "learn" ? ("learn" as const) : undefined,
    // Concepts the browser says are due (§6 resurfacing). The queue lives on
    // the client until identity does, so this arrives with the request rather
    // than being read server-side.
    reviewing: Array.isArray(body.dueTags)
      ? normalizeTags(body.dueTags as (string | null | undefined)[], MAX_DUE_TAGS)
      : undefined,
    frameworks: job.map.stack?.frameworks ?? [],
    modelNames: (job.map.models ?? []).map((m) => m.name),
    questions: [],
  });

  const token = await sessionToken();
  after(() => prepare(session.id, { owner: meta.owner, repo: meta.name }, job.id, token));
  return NextResponse.json({ id: session.id });
}
