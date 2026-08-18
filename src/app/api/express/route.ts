import { NextResponse } from "next/server";
import { getJob } from "@/lib/jobs";
import { buildExpressQuestion } from "@/lib/grill/express";
import { createSession } from "@/lib/grill/store";
import { checkLimit } from "@/lib/ratelimit";

export async function POST(request: Request) {
  const limited = await checkLimit(request, "express");
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

  const question = buildExpressQuestion(job.map);
  if (!question.groundTruth.hubs?.length && !question.groundTruth.names?.length) {
    return NextResponse.json(
      { error: "Not enough structure here to score an explanation — take the questions instead." },
      { status: 400 },
    );
  }

  // One question, ready immediately: no repo download and no model call, since
  // the score comes straight off the graph the map already built.
  const meta = job.map.meta;
  const session = await createSession({
    status: "ready",
    repo: {
      owner: meta.owner,
      name: meta.name,
      defaultBranch: meta.defaultBranch,
      description: meta.description,
    },
    frameworks: job.map.stack?.frameworks ?? [],
    modelNames: (job.map.models ?? []).map((m) => m.name),
    questions: [question],
  });

  return NextResponse.json({ id: session.id });
}
