import { NextResponse } from "next/server";
import { getSession, saveSession } from "@/lib/grill/store";
import { gradeAnswer } from "@/lib/grill/grade";
import { verdictFor } from "@/lib/grill/types";
import { publicView } from "@/lib/grill/view";
import { checkLimit } from "@/lib/ratelimit";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const limited = await checkLimit(request, "answer");
  if (limited) return limited;

  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Grilling not found." }, { status: 404 });
  }
  if (session.status !== "ready" || session.finishedAt) {
    return NextResponse.json({ error: "This grilling isn't accepting answers." }, { status: 409 });
  }

  let body: { answer?: string; latencyMs?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const answer = (body.answer ?? "").trim();
  if (!answer) {
    return NextResponse.json({ error: "Say something — silence scores zero." }, { status: 400 });
  }

  const question = session.questions[session.currentIndex];
  if (!question) {
    return NextResponse.json({ error: "No question pending." }, { status: 409 });
  }

  const result = await gradeAnswer(question, answer, session.modelNames);
  session.attempts.push({
    questionId: question.id,
    answer,
    score: result.score,
    feedback: result.feedback,
    latencyMs: Math.max(0, Math.round(body.latencyMs ?? 0)),
  });
  session.currentIndex += 1;

  if (session.currentIndex >= session.questions.length) {
    const scored = session.attempts.filter((a) => a.score !== null);
    session.score =
      scored.length > 0
        ? Math.round(scored.reduce((s, a) => s + (a.score ?? 0), 0) / scored.length)
        : 0;
    session.verdict = verdictFor(session.score);
    session.finishedAt = Date.now();
  }
  await saveSession(session);

  return NextResponse.json({
    score: result.score,
    feedback: result.feedback,
    reveal: question.groundTruth.reveal,
    state: publicView(session),
  });
}
