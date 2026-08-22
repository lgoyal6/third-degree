import { NextResponse } from "next/server";
import { getSession, saveSession } from "@/lib/grill/store";
import { nextHint, type HintAction } from "@/lib/learn/hints";
import { checkLimit } from "@/lib/ratelimit";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const limited = await checkLimit(request, "hint");
  if (limited) return limited;

  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Grilling not found." }, { status: 404 });
  }

  let body: {
    questionId?: string;
    rung?: number;
    said?: string;
    action?: HintAction;
    pass?: number;
    transcript?: { from: "you" | "duck"; text: string }[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const index = session.questions.findIndex((q) => q.id === body.questionId);
  if (index === -1) {
    return NextResponse.json({ error: "No such question." }, { status: 404 });
  }
  // §4: help and assessment never share a mode. The ladder only opens on a
  // question whose score is already locked in.
  if (index >= session.currentIndex) {
    return NextResponse.json(
      { error: "That question hasn't been answered yet." },
      { status: 409 },
    );
  }

  const said = (body.said ?? "").trim();
  const action: HintAction = body.action === "descend" ? "descend" : "elaborate";
  // Every rung costs a sentence of their own thinking first (§6).
  if (!said && action === "elaborate") {
    return NextResponse.json(
      { error: "Say what you think first — that's the point." },
      { status: 400 },
    );
  }

  const hint = await nextHint(
    session.questions[index],
    (body.transcript ?? []).slice(-8),
    said,
    Math.min(4, Math.max(1, Math.round(body.rung ?? 1))),
    action,
    Math.min(5, Math.max(1, Math.round(body.pass ?? 1))),
  );

  const attempt = session.attempts[index];
  if (attempt) {
    attempt.hintsUsed = (attempt.hintsUsed ?? 0) + 1;
    await saveSession(session);
  }

  return NextResponse.json(hint);
}
