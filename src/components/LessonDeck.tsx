"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { LessonCard } from "@/lib/types";

interface Deck {
  lessons: LessonCard[];
  repo: { owner: string; name: string; defaultBranch: string };
}

const posKey = (jobId: string) => `td:lessons:${jobId}`;

export default function LessonDeck({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [failure, setFailure] = useState<"expired" | "unfinished" | "failed" | null>(null);
  const [index, setIndex] = useState(0);
  const [grilling, setGrilling] = useState(false);
  const [expressError, setExpressError] = useState<string | null>(null);

  const startGrill = useCallback(async () => {
    if (grilling) return;
    setGrilling(true);
    try {
      const res = await fetch("/api/grill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push(`/grill/${data.id}`);
    } catch {
      setGrilling(false);
    }
  }, [grilling, jobId, router]);

  // Layer 4: skip the ladder and defend the whole system in one answer.
  const startExpress = useCallback(async () => {
    if (grilling) return;
    setGrilling(true);
    setExpressError(null);
    try {
      const res = await fetch("/api/express", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't set that up.");
      router.push(`/grill/${data.id}`);
    } catch (err) {
      setExpressError(err instanceof Error ? err.message : "Couldn't set that up.");
      setGrilling(false);
    }
  }, [grilling, jobId, router]);

  // Resumable: the deck is skippable, so returning to it should land where the
  // owner left off rather than at card one.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(`/api/map/${jobId}/lessons`);
        if (!live) return;
        if (res.status === 404) return setFailure("expired");
        if (res.status === 409) return setFailure("unfinished");
        if (!res.ok) return setFailure("failed");
        const data: Deck = await res.json();
        if (!live) return;
        setDeck(data);
        const saved = Number(window.localStorage.getItem(posKey(jobId)));
        if (Number.isInteger(saved) && saved > 0) {
          setIndex(Math.min(saved, Math.max(data.lessons.length - 1, 0)));
        }
      } catch {
        if (live) setFailure("failed");
      }
    })();
    return () => {
      live = false;
    };
  }, [jobId]);

  useEffect(() => {
    if (deck) window.localStorage.setItem(posKey(jobId), String(index));
  }, [deck, index, jobId]);

  const total = deck?.lessons.length ?? 0;
  const onLast = total > 0 && index >= total - 1;

  const next = useCallback(() => {
    if (onLast) {
      void startGrill();
      return;
    }
    setIndex((i) => Math.min(i + 1, total - 1));
  }, [onLast, startGrill, total]);

  const back = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), []);

  useEffect(() => {
    if (!deck) return;
    const onKey = (e: KeyboardEvent) => {
      // Enter is also the activation key for the focused button; let that win.
      const onControl = (e.target as HTMLElement | null)?.closest("button, a");
      if (e.key === "ArrowRight" || (e.key === "Enter" && !onControl)) next();
      else if (e.key === "ArrowLeft") back();
      else if (e.key === "Escape") void startGrill();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back, deck, next, startGrill]);

  if (failure) {
    return (
      <Shell>
        <div className="rounded-xl border border-line bg-surface p-8 text-center">
          <p className="text-lg">
            {failure === "expired"
              ? "This map expired."
              : failure === "unfinished"
                ? "That map is still being built."
                : "Couldn't load the deck."}
          </p>
          <Link
            href={failure === "unfinished" ? `/map/${jobId}` : "/"}
            className="mt-4 inline-block rounded-lg bg-lamp px-5 py-2.5 font-medium text-bg hover:bg-lamp-bright"
          >
            {failure === "unfinished" ? "Back to the map" : "Map a repo"}
          </Link>
        </div>
      </Shell>
    );
  }

  if (!deck) {
    return (
      <Shell>
        <div className="lamp-glow rounded-xl border border-lamp/30 bg-surface p-8 text-center">
          <p className="pulse-soft font-mono text-sm text-lamp">
            Reading the choices your stack made…
          </p>
        </div>
        <div aria-hidden className="pulse-soft h-64 rounded-xl border border-line/60 bg-surface/50" />
      </Shell>
    );
  }

  if (total === 0) {
    return (
      <Shell>
        <div className="rounded-xl border border-line bg-surface p-8 text-center">
          <p className="text-lg">Nothing to teach on this one.</p>
          <p className="mt-2 text-ink-muted">Straight to the questions, then.</p>
          <button
            onClick={startGrill}
            disabled={grilling}
            className="mt-5 cursor-pointer rounded-lg bg-lamp px-6 py-2.5 font-medium text-bg hover:bg-lamp-bright disabled:opacity-60"
          >
            {grilling ? "Preparing the room…" : "Grill me on it →"}
          </button>
        </div>
      </Shell>
    );
  }

  const card = deck.lessons[index];
  const ghBase = `https://github.com/${deck.repo.owner}/${deck.repo.name}/blob/${deck.repo.defaultBranch}`;

  return (
    <Shell>
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-ink-muted">the choices you shipped</p>
          <h1 className="font-display mt-1 text-2xl font-bold tracking-tight">
            {deck.repo.owner}
            <span className="text-ink-muted">/</span>
            {deck.repo.name}
          </h1>
        </div>
        <p className="font-mono text-xs text-ink-muted">
          {index + 1} / {total}
        </p>
      </header>

      <ol className="flex gap-1.5" aria-label="Deck progress">
        {deck.lessons.map((l, i) => (
          <li
            key={`${l.using}-${i}`}
            aria-current={i === index ? "step" : undefined}
            className={`h-1 flex-1 rounded-full ${
              i < index ? "bg-lamp/50" : i === index ? "bg-lamp" : "bg-line"
            }`}
          />
        ))}
      </ol>

      <article
        key={index}
        className="fade-up lamp-glow rounded-xl border border-lamp/30 bg-surface p-8"
        aria-label={`Card ${index + 1}: ${card.using}`}
      >
        <p className="font-mono text-xs text-lamp">using</p>
        <h2 className="font-display mt-1 text-3xl font-bold tracking-tight">{card.using}</h2>
        {card.insteadOf && (
          <p className="mt-2 text-ink-muted">
            instead of <span className="text-ink">{card.insteadOf}</span>
          </p>
        )}

        <p className="mt-6 font-mono text-xs text-lamp">why it fits here</p>
        <p className="mt-2 leading-relaxed">{card.whyItFits}</p>

        {card.whatItCosts && (
          <>
            <p className="mt-5 font-mono text-xs text-lamp">what it costs you</p>
            <p className="mt-2 leading-relaxed text-ink-muted">{card.whatItCosts}</p>
          </>
        )}

        {card.evidence.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-ink-muted">in your code →</span>
            {card.evidence.map((path) => (
              <a
                key={path}
                href={`${ghBase}/${path}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-line px-3 py-1.5 font-mono text-xs hover:border-lamp"
              >
                {path}
              </a>
            ))}
          </div>
        )}
      </article>

      <div className="flex items-center justify-between gap-4">
        <button
          onClick={back}
          disabled={index === 0}
          className="cursor-pointer rounded-lg border border-line px-4 py-2.5 font-mono text-xs text-ink-muted hover:border-lamp hover:text-ink disabled:cursor-default disabled:opacity-30"
        >
          ← back
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={startGrill}
            disabled={grilling}
            className="cursor-pointer rounded-lg px-4 py-2.5 font-mono text-xs text-ink-muted hover:text-lamp disabled:opacity-60"
          >
            esc · skip all
          </button>
          <button
            onClick={next}
            disabled={grilling}
            className="cursor-pointer rounded-lg bg-lamp px-6 py-3 font-medium text-bg hover:bg-lamp-bright disabled:opacity-60"
          >
            {onLast ? (grilling ? "Preparing the room…" : "Grill me on it →") : "Next →"}
          </button>
        </div>
      </div>

      <footer className="flex flex-col items-center gap-2 pb-10 pt-2">
        <button
          onClick={startExpress}
          disabled={grilling}
          className="cursor-pointer font-mono text-xs text-ink-muted hover:text-lamp disabled:opacity-60"
        >
          I already know this repo → one question, one shot
        </button>
        {expressError && <p className="font-mono text-xs text-err">{expressError}</p>}
        <Link href={`/map/${jobId}`} className="font-mono text-xs text-ink-muted hover:text-lamp">
          back to the map
        </Link>
      </footer>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 pt-14">
      {children}
    </main>
  );
}
