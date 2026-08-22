"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GrillView as ViewState } from "@/lib/grill/view";
import { VERDICT_COPY, type Verdict } from "@/lib/grill/types";
import StreakBadge from "@/components/StreakBadge";
import StatusLine from "@/components/StatusLine";
import { recordCompletion } from "@/lib/progress";

const LAYER_LABEL: Record<number, string> = { 1: "fundamentals", 2: "modules", 3: "seams", 4: "the whole system" };
const POLL_MS = 900;

interface LastResult {
  score: number | null;
  feedback: string;
  reveal: string;
}

export default function GrillView({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [state, setState] = useState<ViewState | null>(null);
  const [lost, setLost] = useState(false);
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [last, setLast] = useState<LastResult | null>(null);
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
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

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
      setLast({ score: data.score, feedback: data.feedback, reveal: data.reveal });
      setState(data.state);
      setAnswer("");
    } catch {
      // keep the answer in the box; user can retry
    } finally {
      setSubmitting(false);
    }
  }, [answer, submitting, sessionId]);

  const next = useCallback(() => {
    setLast(null);
    questionShownAt.current = Date.now();
    setElapsed(0);
    setTimeout(() => answerRef.current?.focus(), 0);
  }, []);

  // Enter advances the feedback screen
  useEffect(() => {
    if (!last || state?.finished) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [last, state?.finished, next]);

  if (lost) return <Message text="This grilling expired." cta="Map a repo" />;
  if (!state) return <Preparing label="loading" />;
  if (state.status === "preparing") return <Preparing label="sharpening the questions" />;
  if (state.status === "error") {
    return <Message text={state.error ?? "Couldn't build the grilling."} cta="Back to safety" />;
  }
  if (state.finished) return <ScoreScreen state={state} />;

  const q = state.question;
  if (!q) return <Preparing label="loading" />;

  // Feedback interstitial after each answer
  if (last) {
    return (
      <>
      <StatusLine repo={`${state.repo.owner}/${state.repo.name}`} branch={state.repo.defaultBranch}>
        <span className="text-ink-muted">graded</span>
        <StreakBadge />
      </StatusLine>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-6 py-12">
        <p className="font-mono text-xs text-ink-muted">
          question {String(state.currentIndex).padStart(2, "0")} of{" "}
          {String(state.total).padStart(2, "0")}
        </p>
        <div className="fade-up rounded-md border border-line bg-surface p-6">
          <p className="font-display text-3xl font-bold">
            {last.score === null ? (
              <span className="text-ink-muted">ungraded</span>
            ) : (
              <span className={last.score >= 60 ? "text-ok" : last.score >= 30 ? "text-attention" : "text-err"}>
                {last.score}
                <span className="text-lg text-ink-muted">/100</span>
              </span>
            )}
          </p>
          <p className="mt-3">{last.feedback}</p>
          <div className="mt-5 rounded bg-surface-2 p-4">
            <p className="font-mono text-xs text-lamp">the answer</p>
            <pre className="mt-2 whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink-muted">{last.reveal}</pre>
          </div>
        </div>
        <button
          onClick={next}
          autoFocus
          className="cursor-pointer self-end rounded bg-lamp px-6 py-3 font-medium text-bg hover:bg-lamp-bright"
        >
          {state.currentIndex >= state.total ? "See the verdict" : "Next question"} ⏎
        </button>
      </main>
      </>
    );
  }

  return (
    <>
      <StatusLine repo={`${state.repo.owner}/${state.repo.name}`} branch={state.repo.defaultBranch}>
        <span className="text-lamp">{LAYER_LABEL[q.layer]}</span>
        <StreakBadge />
        <span className="tabular-nums text-ink" aria-label="elapsed time">
          {String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")}
        </span>
      </StatusLine>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-6">
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

      <div className={`mt-8 grid flex-1 gap-6 ${q.contextCode ? "lg:grid-cols-2" : ""}`}>
        {q.contextCode && (
          <div className="min-h-0 overflow-auto rounded-md border border-line bg-surface">
            <p className="sticky top-0 z-10 border-b border-line bg-surface px-4 py-2 font-mono text-xs text-lamp">
              {q.contextCode.file}
            </p>
            {/* Gutter numbers are the file's own lines, not a count from one */}
            <div className="flex">
              <div
                aria-hidden
                className="shrink-0 select-none border-r border-line px-3 py-4 text-right font-mono text-xs leading-relaxed text-ink-muted/40"
              >
                {q.contextCode.code.split("\n").map((_, i) => (
                  <div key={i}>{(q.contextCode?.startLine ?? 1) + i}</div>
                ))}
              </div>
              <pre className="overflow-x-auto px-4 py-4 font-mono text-xs leading-relaxed text-ink-muted">
                {q.contextCode.code}
              </pre>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-4">
          <p className="fade-up text-lg leading-relaxed">{renderPrompt(q.prompt)}</p>
          <textarea
            ref={answerRef}
            autoFocus
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
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
          <div className="flex items-center justify-between">
            <p className="font-mono text-xs text-ink-muted">⏎ submit · shift+⏎ newline · esc quit</p>
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
    </>
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
      {/* The one surface in the product that is not the editor: the verdict is a
          document you are handed, which is also what makes it worth screenshotting. */}
      <section className="paper fade-up rounded-sm p-8 shadow-lg shadow-black/40">
        <div className="flex items-baseline justify-between gap-4 border-b-2 border-paper-rule pb-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-muted">
            third degree
          </p>
          <p className="font-mono text-xs text-paper-muted">
            {state.repo.owner}/{state.repo.name}
          </p>
        </div>
        <div className="mt-8 flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="font-paper flex items-end gap-2 font-bold leading-none">
              <span className="text-7xl">{state.score}</span>
              <span className="pb-1 text-2xl text-paper-muted">/100</span>
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
            </li>
          ))}
        </ol>
      </section>

      <footer className="pb-10 text-center">
        <Link href="/" className="font-mono text-xs text-ink-muted hover:text-lamp">
          map another repo
        </Link>
      </footer>
    </main>
    </>
  );
}
