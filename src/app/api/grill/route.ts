import { after } from "next/server";
import { NextResponse } from "next/server";
import { getJob } from "@/lib/jobs";
import { fetchRepo } from "@/lib/indexer/fetch";
import { walkRepo } from "@/lib/indexer/walk";
import { generateQuestions } from "@/lib/grill/generate";
import { createSession, getSession, saveSession } from "@/lib/grill/store";
import { checkLimit } from "@/lib/ratelimit";
import { sessionToken } from "@/lib/auth/github";

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
    // Warm instances still have the extracted tarball from the map run;
    // otherwise this re-downloads it.
    const root = await fetchRepo(ref, userToken);
    const { files } = walkRepo(root);
    session.questions = await generateQuestions(root, job.map, files);
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

  let body: { jobId?: string };
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
    },
    frameworks: job.map.stack?.frameworks ?? [],
    modelNames: (job.map.models ?? []).map((m) => m.name),
    questions: [],
  });

  const token = await sessionToken();
  after(() => prepare(session.id, { owner: meta.owner, repo: meta.name }, job.id, token));
  return NextResponse.json({ id: session.id });
}
