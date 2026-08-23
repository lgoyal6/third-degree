"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GrillView as ViewState } from "@/lib/grill/view";
import { PASS_MARK, VERDICT_COPY, type Verdict } from "@/lib/grill/types";
import StreakBadge from "@/components/StreakBadge";
import StatusLine from "@/components/StatusLine";
import HintLadder from "@/components/HintLadder";
import Duck from "@/components/Duck";
import ReviewLink from "@/components/ReviewLink";
import { recordCompletion } from "@/lib/progress";
import { dueTags, recordAnswer } from "@/lib/review";

const LAYER_LABEL: Record<number, string> = { 1: "fundamentals", 2: "modules", 3: "seams", 4: "the whole system" };
const POLL_MS = 900;

interface LastResult {
  score: number | null;
  feedback: string;
  reveal: string;
  /** Learn mode: the same question is coming back for one more try. */
  retry?: boolean;
}

// §6's struggle signals, in the only forms a Q&A surface can actually observe.
const NUDGE_COPY: Record<string, string> = {
  dwell: "Still on this one. Tell me what you think is happening and we'll go from there.",
  scrub: "You keep starting over. Easier out loud than on the page?",
};

export default function GrillView({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [state, setState] = useState<ViewState | null>(null);
  const [lost, setLost] = useState(false);
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [last, setLast] = useState<LastResult | null>(null);
  const [learning, setLearning] = useState(false);
  const [returned, setReturned] = useState<string[]>([]);
  const [helping, setHelping] = useState(false); // ladder open on the live question
  const [nudge, setNudge] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  // Where rung 2 pointed. Kept after the ladder closes, since the region is
  // still the thing worth looking at.
  const [focus, setFocus] = useState<{ startLine: number; endLine: number } | null>(null);
  const litLine = useRef<HTMLDivElement>(null);
  const hinted = useRef<Set<string>>(new Set());
  const typedAt = useRef<number>(0);
  const peak = useRef(0);
  const scrubs = useRef(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const questionShownAt = useRef<number | null>(null);
  const answerRef = useRef<HTMLTextAreaElement>(null);

  // Poll while preparing; a single fetch otherwise.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const load = async () => {
      const res = await fetch(`/api/grill/${sessionId}`);
      if (res.status === 404) {
        setLost(true);
        if (timer) clearInterval(timer);
        return;
      }
      const data: ViewState = await res.json();
      setState(data);
      if (data.status !== "preparing" && timer) clearInterval(timer);
    };
    load();
    timer = setInterval(load, POLL_MS);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [sessionId]);

  // Visible timer (Grill is Defend-lite: no help, clock on)
  useEffect(() => {
    questionShownAt.current = Date.now();
    const t = setInterval(() => {
      setElapsed(Math.floor((Date.now() - (questionShownAt.current ?? Date.now())) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // A finished session pays out once, whether it was the ladder or the express
  // path; recordCompletion is keyed, so reloading the verdict is free.
  useEffect(() => {
    if (state?.finished) recordCompletion(`grill:${sessionId}`, state.score ?? 0);
  }, [state?.finished, state?.score, sessionId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.push("/");
      // §7: `?` opens the companion. Learn mode only, and never mid-sentence.
      if (e.key === "?" && state?.mode === "learn") {
        const el = e.target as HTMLElement | null;
        if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) return;
        e.preventDefault();
        setNudge(null);
        setCollapsed(false);
        setHelping(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, state?.mode]);

  // A question worked through with the duck is not one they knew cold, so the
  // review card is filed as a miss however the answer then scores.
  useEffect(() => {
    if (helping && state?.question) hinted.current.add(state.question.id);
  }, [helping, state?.question]);

  useEffect(() => {
    if (focus) litLine.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focus]);

  // §6's dwell signal: sitting on a question with nothing on the page.
  useEffect(() => {
    if (state?.mode !== "learn" || last || helping) return;
    const t = setInterval(() => {
      const since = Math.max(typedAt.current, questionShownAt.current ?? 0);
      if (Date.now() - since > 45_000 && answer.trim().length < 40) {
        setNudge((n) => n ?? "dwell");
      }
    }, 5_000);
    return () => clearInterval(t);
  }, [state?.mode, last, helping, answer]);

  const submit = useCallback(async () => {
    if (!answer.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/grill/${sessionId}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answer,
          latencyMs: Date.now() - (questionShownAt.current ?? Date.now()),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't grade that.");
      setLast({ score: data.score, feedback: data.feedback, reveal: data.reveal, retry: data.retry });
      setState(data.state);
      // A retry keeps the text so they can sharpen it rather than retype it.
      if (!data.retry) setAnswer("");
      // File the result against the concepts it tested once the question is
      // settled, and notice when one the queue was waiting on has come back.
      const graded: ViewState["answered"][number] | undefined =
        data.state.answered[data.state.answered.length - 1];
      if (graded && !data.retry) {
        const waiting = dueTags();
        setReturned(graded.conceptTags.filter((t) => waiting.includes(t)));
        recordAnswer({
          tags: graded.conceptTags,
          score: data.score,
          repo: `${data.state.repo.owner}/${data.state.repo.name}`,
          prompt: graded.prompt,
          hinted: hinted.current.has(graded.id),
        });
      }
    } catch {
      // keep the answer in the box; user can retry
    } finally {
      setSubmitting(false);
    }
  }, [answer, submitting, sessionId]);

  const next = useCallback(() => {
    setLast(null);
    setLearning(false);
    setShowAnswer(false);
    setReturned([]);
    setHelping(false);
    setCollapsed(false);
    setNudge(null);
    setFocus(null);
    typedAt.current = Date.now();
    peak.current = 0;
    scrubs.current = 0;
    questionShownAt.current = Date.now();
    setElapsed(0);
    setTimeout(() => answerRef.current?.focus(), 0);
  }, []);

  // Enter advances the feedback screen
  useEffect(() => {
    if (!last || state?.finished || learning) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [last, state?.finished, learning, next]);

  if (lost) return <Message text="This grilling expired." cta="Map a repo" />;
  if (!state) return <Preparing label="loading" />;
  if (state.status === "preparing") return <Preparing label="sharpening the questions" />;
  if (state.status === "error") {
    return <Message text={state.error ?? "Couldn't build the grilling."} cta="Back to safety" />;
  }
  if (state.finished) return <ScoreScreen state={state} />;

  const q = state.question;
  if (!q) return <Preparing label="loading" />;
  const learn = state.mode === "learn";

  // Learn mode: missed, and the same question is coming back. No reveal was
  // sent, which is what makes the second try worth anything.
  if (last?.retry) {
    return (
      <>
        <StatusLine repo={`${state.repo.owner}/${state.repo.name}`} branch={state.repo.defaultBranch}>
          <span className="text-ink-muted">learn mode</span>
          <StreakBadge />
        </StatusLine>
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-6 py-8">
          <p className="font-mono text-xs text-ink-muted">
            question {String(state.currentIndex + 1).padStart(2, "0")} of{" "}
            {String(state.total).padStart(2, "0")} · try two
          </p>
          <div className="fade-up rounded-md border border-attention/40 bg-surface">
            <div className="border-b border-line px-6 py-4">
              <p className="text-sm leading-relaxed">{renderPrompt(q.prompt)}</p>
              <p className="mt-3 font-mono text-xs leading-relaxed text-ink-muted">
                <span className="text-ink-muted/60">you said</span> {answer}
              </p>
            </div>
            <div className="px-6 py-5">
              <p className="font-mono text-xs text-attention">not there yet</p>
              <p className="mt-2 leading-relaxed">{last.feedback}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="max-w-sm text-sm text-ink-muted">
              Same question, your answer still in the box. Sharpen it, or talk it through first.
            </p>
            <div className="flex items-center gap-3">
              {!helping && (
                <button
                  onClick={() => setHelping(true)}
                  className="cursor-pointer font-mono text-xs text-ink-muted hover:text-lamp"
                >
                  talk it through
                </button>
              )}
              <button
                onClick={next}
                autoFocus
                className="cursor-pointer rounded bg-lamp px-6 py-3 font-medium text-bg hover:bg-lamp-bright"
              >
                Try again ⏎
              </button>
            </div>
          </div>
          {helping && (
            <HintLadder
              sessionId={sessionId}
              questionId={q.id}
              onFinished={() => setHelping(false)}
              finishLabel="Back to the question ⏎"
            />
          )}
        </main>
      </>
    );
  }

  // Feedback interstitial after each answer
  if (last) {
    const graded = state.answered[state.answered.length - 1];
    const lastPrompt = graded?.prompt ?? "";
    const lastAnswer = graded?.answer ?? "";
    const lastLayer = graded?.layer ?? 1;
    const gradedId = graded?.id ?? "";
    // "Missed" is the on-ramp trigger (§4): below the passing band, or ungraded.
    const missed = last.score === null || last.score < PASS_MARK;
    return (
      <>
      <StatusLine repo={`${state.repo.owner}/${state.repo.name}`} branch={state.repo.defaultBranch}>
        <span className="text-ink-muted">graded</span>
        <StreakBadge />
      </StatusLine>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-6 py-8">
        <div>
          <p className="font-mono text-xs text-ink-muted">
            question {String(state.currentIndex).padStart(2, "0")} of{" "}
            {String(state.total).padStart(2, "0")}
          </p>
          {/* Same ladder as the question screen: losing it mid-flow broke the
              sense of where you are. */}
          <div className="mt-2 flex gap-1" aria-hidden>
            {Array.from({ length: state.total }, (_, i) => (
              <div
                key={i}
                className={`h-0.5 flex-1 rounded-full ${i < state.currentIndex ? "bg-lamp" : "bg-line"}`}
              />
            ))}
          </div>
        </div>

        <div className="fade-up rounded-md border border-line bg-surface">
          {/* You cannot judge a grade without seeing what was asked and what you
              said, and without them the screen was a score floating in a void. */}
          <div className="border-b border-line px-6 py-4">
            <p className="text-sm leading-relaxed">{renderPrompt(lastPrompt)}</p>
            <p className="mt-3 font-mono text-xs leading-relaxed text-ink-muted">
              <span className="text-ink-muted/60">you said</span> {lastAnswer}
            </p>
          </div>

          <div className="flex items-baseline gap-4 px-6 pt-5">
            <p className="font-display text-5xl font-semibold leading-none">
              {last.score === null ? (
                <span className="text-2xl text-ink-muted">ungraded</span>
              ) : (
                <span className={last.score >= 60 ? "text-ok" : last.score >= 30 ? "text-attention" : "text-err"}>
                  {last.score}
                  <span className="text-xl text-ink-muted">/100</span>
                </span>
              )}
            </p>
            <p className="font-mono text-xs text-lamp">{LAYER_LABEL[lastLayer] ?? ""}</p>
            <ConceptTags tags={graded?.conceptTags ?? []} />
            {returned.length > 0 && (
              <span className="font-mono text-[11px] text-attention" title={returned.join(", ")}>
                back from review
              </span>
            )}
          </div>
          <p className="px-6 pt-3 leading-relaxed">{last.feedback}</p>

          {(!missed || showAnswer) && (
            <div className="mt-5 border-t border-line bg-surface-2 px-6 py-4">
              <p className="font-mono text-xs text-lamp">the answer</p>
              <pre className="mt-2 whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink-muted">{last.reveal}</pre>
            </div>
          )}
        </div>

        {learning ? (
          <HintLadder sessionId={sessionId} questionId={gradedId} onFinished={next} />
        ) : missed && !showAnswer ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="max-w-sm text-sm text-ink-muted">
              You missed this one. Work it out instead of reading the answer and it stays with you.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowAnswer(true)}
                className="cursor-pointer font-mono text-xs text-ink-muted hover:text-lamp"
              >
                just show me
              </button>
              <button
                onClick={() => setLearning(true)}
                autoFocus
                className="cursor-pointer rounded bg-lamp px-6 py-3 font-medium text-bg hover:bg-lamp-bright"
              >
                Work it out →
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={next}
            autoFocus
            className="cursor-pointer self-end rounded bg-lamp px-6 py-3 font-medium text-bg hover:bg-lamp-bright"
          >
            {state.currentIndex >= state.total ? "See the verdict" : "Next question"} ⏎
          </button>
        )}
      </main>
      </>
    );
  }

  return (
    <>
      <StatusLine repo={`${state.repo.owner}/${state.repo.name}`} branch={state.repo.defaultBranch}>
        <span className="text-lamp">{LAYER_LABEL[q.layer]}</span>
        <StreakBadge />
        {learn ? (
          <span className="text-ink-muted">learn mode</span>
        ) : (
          <span className="tabular-nums text-ink" aria-label="elapsed time">
            {String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")}
          </span>
        )}
      </StatusLine>
      <main
        className={`mx-auto flex w-full flex-1 flex-col px-6 py-6 ${
          q.contextCode ? "max-w-6xl" : "max-w-3xl"
        }`}
      >
      <div className="flex items-baseline justify-between font-mono text-xs text-ink-muted">
        <span>
          question {String(state.currentIndex + 1).padStart(2, "0")} of{" "}
          {String(state.total).padStart(2, "0")}
        </span>
      </div>

      {/* Ladder progress — physical, not a percentage */}
      <div className="mt-2 flex gap-1" aria-hidden>
        {Array.from({ length: state.total }, (_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full ${i < state.currentIndex ? "bg-lamp" : i === state.currentIndex ? "bg-lamp/50" : "bg-line"}`}
          />
        ))}
      </div>

      <div className={`mt-8 grid gap-6 ${q.contextCode ? "flex-1 lg:grid-cols-2" : ""}`}>
        {q.contextCode && (
          <div className="min-h-0 overflow-auto rounded-md border border-line bg-surface">
            <p className="sticky top-0 z-10 border-b border-line bg-surface px-4 py-2 font-mono text-xs text-lamp">
              {q.contextCode.file}
            </p>
            {/* One row per line: gutter numbers are the file's own, and the
                duck's rung 2 needs to point at a range rather than name it. */}
            <div className="py-4 font-mono text-xs leading-relaxed">
              {q.contextCode.code.split("\n").map((line, i) => {
                const number = (q.contextCode?.startLine ?? 1) + i;
                const lit = focus !== null && number >= focus.startLine && number <= focus.endLine;
                return (
                  <div
                    key={i}
                    ref={lit && number === focus.startLine ? litLine : undefined}
                    className="flex w-max min-w-full"
                  >
                    <span
                      aria-hidden
                      className={`sticky left-0 z-10 w-12 shrink-0 select-none border-r bg-surface pr-3 text-right ${
                        lit ? "border-lamp text-lamp" : "border-line text-ink-muted/40"
                      }`}
                    >
                      {number}
                    </span>
                    <span className={`whitespace-pre px-4 ${lit ? "bg-lamp/10 text-ink" : "text-ink-muted"}`}>
                      {line || " "}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-4">
          <p className="fade-up text-lg leading-relaxed">{renderPrompt(q.prompt)}</p>
          <textarea
            ref={answerRef}
            autoFocus
            value={answer}
            onChange={(e) => {
              setAnswer(e.target.value);
              typedAt.current = Date.now();
              // §6's start-delete-restart signal.
              const len = e.target.value.trim().length;
              if (len > peak.current) peak.current = len;
              else if (peak.current >= 25 && len < peak.current * 0.4) {
                peak.current = len;
                scrubs.current += 1;
                if (scrubs.current >= 2) setNudge((n) => n ?? "scrub");
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Type your answer. Specifics beat generalities — name files, functions, fields."
            rows={q.kind === "overview" ? 12 : 7}
            className="w-full flex-none resize-none rounded-md border border-line bg-surface p-4 font-mono text-sm placeholder:text-ink-muted/50"
          />
          {learn && helping && (
            // Kept mounted while collapsed: hiding the duck should not throw
            // away the conversation you paid for in sentences.
            <div className={collapsed ? "hidden" : ""}>
              <HintLadder
                sessionId={sessionId}
                questionId={q.id}
                onFinished={() => setHelping(false)}
                finishLabel="Back to the question ⏎"
                onFocus={setFocus}
              />
            </div>
          )}

          <div className="flex items-center justify-between">
            <p className="font-mono text-xs text-ink-muted">
              ⏎ submit · shift+⏎ newline{learn ? " · ? stuck" : ""} · esc quit
            </p>
            <button
              onClick={submit}
              disabled={submitting || !answer.trim()}
              className="cursor-pointer rounded bg-lamp px-6 py-2.5 font-medium text-bg hover:bg-lamp-bright disabled:opacity-50"
            >
              {submitting ? "Grading…" : "Answer"}
            </button>
          </div>
        </div>
      </div>
      </main>
      {learn && (
        <Duck
          nudge={nudge ? NUDGE_COPY[nudge] : null}
          open={helping}
          collapsed={collapsed}
          onOpen={() => {
            setNudge(null);
            setCollapsed(false);
            setHelping(true);
          }}
          onDismiss={() => setNudge(null)}
          onToggle={() => setCollapsed((c) => !c)}
        />
      )}
    </>
  );
}

/** What the question was really testing, in transferable terms (§8). */
function ConceptTags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <span className="flex flex-wrap items-baseline gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="rounded border border-line px-1.5 font-mono text-[11px] text-ink-muted"
        >
          {tag}
        </span>
      ))}
    </span>
  );
}

function renderPrompt(prompt: string) {
  // Render `code` spans in prompts
  const parts = prompt.split(/(`[^`]+`)/g);
  return parts.map((p, i) =>
    p.startsWith("`") && p.endsWith("`") ? (
      <code key={i} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-base text-lamp">
        {p.slice(1, -1)}
      </code>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

function Preparing({ label }: { label: string }) {
  return (
    <main className="flex flex-1 items-center justify-center">
      <p className="pulse-soft font-mono text-sm text-lamp">{label}…</p>
    </main>
  );
}

function Message({ text, cta }: { text: string; cta: string }) {
  return (
    <main className="flex flex-1 items-center justify-center px-6">
      <div className="rounded-md border border-line bg-surface p-8 text-center">
        <p>{text}</p>
        <Link
          href="/"
          className="mt-4 inline-block rounded bg-lamp px-5 py-2.5 font-medium text-bg hover:bg-lamp-bright"
        >
          {cta}
        </Link>
      </div>
    </main>
  );
}

function ScoreScreen({ state }: { state: ViewState }) {
  const [copied, setCopied] = useState(false);
  const learn = state.mode === "learn";
  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/s/${state.slug}` : `/s/${state.slug}`;
  const verdict = (state.verdict ?? "raw") as Verdict;

  return (
    <>
    <StatusLine repo={`${state.repo.owner}/${state.repo.name}`} branch={state.repo.defaultBranch}>
      <span className="text-ink-muted">
        {state.answered.length} of {state.total} answered
      </span>
    </StatusLine>
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-10">
      {/* Learn mode's output is progress and review cards, not a share card
          (§4): a score you were talked through is not one to show anyone. */}
      {learn ? (
        <section className="fade-up rounded-md border border-line bg-surface p-8">
          <p className="font-mono text-xs text-lamp">session done</p>
          <p className="mt-3 font-display text-2xl font-semibold">
            You worked through {state.answered.length} question
            {state.answered.length === 1 ? "" : "s"}.
          </p>
          <p className="mt-2 max-w-lg leading-relaxed text-ink-muted">
            No share card here, and no verdict. What you missed is filed by concept and comes back
            when something else tests the same idea.
          </p>
          <p className="mt-5 border-t border-line pt-4 font-mono text-xs text-ink-muted">
            {state.score}/100 across the session, kept between us
          </p>
        </section>
      ) : (
      <section className="paper fade-up rounded-sm p-8 shadow-lg shadow-black/40">
        <div className="flex items-baseline justify-between gap-4 border-b-2 border-paper-rule pb-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-muted">
            third degree
          </p>
          <p className="font-mono text-xs text-paper-muted">
            {state.repo.owner}/{state.repo.name}
          </p>
        </div>
        <div className="mt-8 flex flex-wrap items-end gap-x-10 gap-y-6">
          <div>
            <p className="font-paper flex items-end gap-2 font-bold leading-none">
              <span className="text-8xl">{state.score}</span>
              <span className="pb-2 text-3xl text-paper-muted">/100</span>
            </p>
            <p className="mt-3 max-w-sm text-sm text-paper-muted">{VERDICT_COPY[verdict]}</p>
          </div>
          <p className="-rotate-3 rounded border-2 border-stamp px-3 py-1 font-mono text-lg font-semibold uppercase tracking-[0.2em] text-stamp">
            {verdict}
          </p>
        </div>
        {state.repo.private ? (
          <p className="mt-6 border-t border-paper-rule pt-4 font-mono text-xs text-paper-muted">
            private repo · no share card, since the questions name your files
          </p>
        ) : (
          <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-paper-rule pt-5">
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(shareUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="cursor-pointer rounded bg-paper-ink px-5 py-2.5 font-medium text-paper hover:opacity-90"
            >
              {copied ? "Copied" : "Copy share link"}
            </button>
            <Link
              href={`/s/${state.slug}`}
              className="rounded border border-paper-rule px-5 py-2.5 font-medium hover:border-paper-ink"
            >
              View card
            </Link>
          </div>
        )}
      </section>
      )}

      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold">The tape</h2>
        <StreakBadge />
      </div>
      <section aria-label="Review">
        <ol className="mt-4 space-y-3">
          {state.answered.map((a, i) => (
            <li key={i} className="rounded-md border border-line bg-surface p-5">
              <div className="flex items-baseline justify-between gap-4">
                <p className="text-sm">{renderPrompt(a.prompt)}</p>
                <span
                  className={`font-mono text-sm ${a.score === null ? "text-ink-muted" : a.score >= 60 ? "text-ok" : a.score >= 30 ? "text-attention" : "text-err"}`}
                >
                  {a.score === null ? "—" : a.score}
                </span>
              </div>
              <p className="mt-2 font-mono text-xs text-ink-muted">you said: {a.answer}</p>
              <p className="mt-2 text-xs text-ink-muted">{a.feedback}</p>
              <div className="mt-3">
                <ConceptTags tags={a.conceptTags} />
              </div>
            </li>
          ))}
        </ol>
      </section>

      <footer className="flex flex-wrap items-center gap-5 pb-10">
        {state.jobId && (
          <Link
            href={`/map/${state.jobId}/craft`}
            className="font-mono text-xs text-lamp hover:text-lamp-bright"
          >
            what to upgrade next →
          </Link>
        )}
        <Link href="/" className="font-mono text-xs text-ink-muted hover:text-lamp">
          map another repo
        </Link>
        <ReviewLink />
      </footer>
    </main>
    </>
  );
}
