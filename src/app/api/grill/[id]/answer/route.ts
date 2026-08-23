import { NextResponse } from "next/server";
import { getSession, saveSession } from "@/lib/grill/store";
import { gradeAnswer } from "@/lib/grill/grade";
import { PASS_MARK, verdictFor } from "@/lib/grill/types";
import { GRACE_MS, limitFor } from "@/lib/grill/defend";
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

  let body: { answer?: string; latencyMs?: number; timedOut?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const question = session.questions[session.currentIndex];
  if (!question) {
    return NextResponse.json({ error: "No question pending." }, { status: 409 });
  }

  const defend = session.mode === "defend";
  // The clock is the server's: elapsed is measured from when the question was
  // served, so a paused tab or a patched countdown buys nothing.
  const elapsed = session.askedAt ? Date.now() - session.askedAt : 0;
  const expired = defend && elapsed > limitFor(question.layer) + GRACE_MS;

  const answer = (body.answer ?? "").trim();
  if (!answer && !(defend && (body.timedOut || expired))) {
    return NextResponse.json({ error: "Say something — silence scores zero." }, { status: 400 });
  }

  // Nothing to grade when the clock beat them to it, and nothing to spend a
  // grading call on either.
  const timedOut = defend && (expired || (!answer && Boolean(body.timedOut)));
  const result = timedOut
    ? { score: 0, feedback: "Time ran out on this one." }
    : await gradeAnswer(question, answer, session.modelNames);
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
    ...(timedOut ? { timedOut: true } : {}),
    score: result.score,
    feedback: result.feedback,
    // Defend records the clock it kept, not the one the client reports.
    latencyMs: defend ? Math.max(0, elapsed) : Math.max(0, Math.round(body.latencyMs ?? 0)),
    hintsUsed: pending?.hintsUsed ?? session.hintsAhead?.[question.id],
  };
  if (pending) session.attempts[session.currentIndex] = attempt;
  else session.attempts.push(attempt);

  const retry =
    session.mode === "learn" &&
    tries < 2 &&
    (result.score === null || result.score < PASS_MARK);
  if (!retry) {
    session.currentIndex += 1;
    session.askedAt = Date.now(); // the next question's clock starts now
  }

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

  // Defend tells them nothing until the recording: a score after every answer
  // is coaching, and §4 keeps coaching out of this mode entirely.
  if (defend) {
    return NextResponse.json({ recorded: true, timedOut, retry: false, state: publicView(session) });
  }

  return NextResponse.json({
    score: result.score,
    feedback: result.feedback,
    retry,
    // Holding the answer back is the whole point of offering another try.
    reveal: retry ? undefined : question.groundTruth.reveal,
    state: publicView(session),
  });
}
