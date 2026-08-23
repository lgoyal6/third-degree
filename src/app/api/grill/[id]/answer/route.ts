import { NextResponse } from "next/server";
import { getSession, saveSession } from "@/lib/grill/store";
import { gradeAnswer } from "@/lib/grill/grade";
import { PASS_MARK, verdictFor } from "@/lib/grill/types";
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
  // Learn mode gives one more run at a missed question — §6's "two wrong
  // attempts" signal cannot exist otherwise, and a single shot is assessment,
  // which is Grill's job. The attempt is replaced rather than appended, since
  // attempts are read positionally against questions.
  const pending = session.attempts[session.currentIndex];
  const tries = (pending?.tries ?? 0) + 1;
  const attempt = {
    questionId: question.id,
    answer,
    tries,
    score: result.score,
    feedback: result.feedback,
    latencyMs: Math.max(0, Math.round(body.latencyMs ?? 0)),
    hintsUsed: pending?.hintsUsed ?? session.hintsAhead?.[question.id],
  };
  if (pending) session.attempts[session.currentIndex] = attempt;
  else session.attempts.push(attempt);

  const retry =
    session.mode === "learn" &&
    tries < 2 &&
    (result.score === null || result.score < PASS_MARK);
  if (!retry) session.currentIndex += 1;

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
    retry,
    // Holding the answer back is the whole point of offering another try.
    reveal: retry ? undefined : question.groundTruth.reveal,
    state: publicView(session),
  });
}
