"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import StatusLine from "@/components/StatusLine";
import StreakBadge from "@/components/StreakBadge";
import StorageNote from "@/components/StorageNote";
import { readCards } from "@/lib/review";
import { readShelf } from "@/lib/shelf";
import type { Curriculum, Module } from "@/lib/learn/curriculum";
import type { Level } from "@/lib/learn/mastery";

const LEVEL_TONE: Record<Level, string> = {
  untested: "text-ink-muted",
  shaky: "text-err",
  learning: "text-attention",
  steady: "text-lamp",
  owned: "text-ok",
};

const LAYER_NAME: Record<number, string> = {
  1: "fundamentals",
  2: "modules",
  3: "seams",
  4: "the whole system",
};

/**
 * §10a's full curriculum. Everything on this screen was derived from their own
 * answers: the concepts are the ones their misses produced, the order is the §3
 * layer each was tested at, and the modules are groupings of that list. Nothing
 * here is a syllabus, which is what §8 rules out — so the screen says so.
 */
export default function PathView() {
  const router = useRouter();
  const [data, setData] = useState<Curriculum | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [repo, setRepo] = useState<{ jobId: string; repo: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      // The capstone is about a repo, so it needs one: the most recently mapped
      // is the one they are most likely still thinking about.
      const shelf = readShelf();
      const first = shelf[0] ? { jobId: shelf[0].jobId, repo: shelf[0].repo } : null;
      setRepo(first);
      try {
        const res = await fetch("/api/curriculum", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cards: readCards(), jobId: first?.jobId }),
        });
        const body = await res.json();
        if (!res.ok) setError(body.error ?? "Couldn't build the path.");
        else setData(body);
      } catch {
        setError("Couldn't reach the server.");
      }
    })();
  }, []);

  const practise = useCallback(
    async (module: Module) => {
      if (!repo || busy) return;
      setBusy(module.title);
      try {
        const res = await fetch("/api/grill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: repo.jobId, mode: "learn", dueTags: module.tags }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Couldn't start that.");
        router.push(`/grill/${body.id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't start that.");
        setBusy(null);
      }
    },
    [busy, repo, router],
  );

  return (
    <>
      <StatusLine repo="your path" branch={data ? `${data.mastery.length} concepts` : undefined}>
        <StreakBadge />
      </StatusLine>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-10">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Your path</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-muted">
            Not a syllabus. Every concept below is one your own answers turned up, ordered by where
            it was tested — the language first, then how your app is wired, then what breaks when
            you change it.
          </p>
        </div>

        {error && <p className="font-mono text-xs text-err">{error}</p>}

        {!data && !error && (
          <div aria-hidden className="pulse-soft h-48 rounded-md border border-line/60 bg-surface/50" />
        )}

        {data && data.modules.length === 0 && (
          <div className="rounded-md border border-line bg-surface p-8">
            <p>Nothing to build a path from yet.</p>
            <p className="mt-2 text-sm text-ink-muted">
              A path needs concepts, and concepts come from answering questions about your own code.
              Map a repo and get through a grilling first.
            </p>
            <Link
              href="/"
              className="mt-5 inline-block rounded bg-lamp px-5 py-2.5 font-medium text-bg hover:bg-lamp-bright"
            >
              Map a repo
            </Link>
          </div>
        )}

        {data?.modules.map((module, i) => (
          <section key={module.title} className="rounded-md border border-line bg-surface">
            <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line px-5 py-3">
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="font-mono text-xs text-ink-muted">{String(i + 1).padStart(2, "0")}</span>
                <h2 className="font-display text-lg font-semibold">{module.title}</h2>
                <span className="font-mono text-[11px] text-lamp">{LAYER_NAME[module.layer]}</span>
              </div>
              <Bar mastery={module.mastery} />
            </div>

            <p className="px-5 pt-4 text-sm leading-relaxed text-ink-muted">{module.why}</p>
            {module.after && (
              <p className="px-5 pt-2 font-mono text-[11px] text-ink-muted/70">
                easier after “{module.after}”
              </p>
            )}

            <ul className="mt-4 divide-y divide-line/60 border-t border-line/60">
              {module.tags.map((tag) => {
                const m = data.mastery.find((x) => x.tag === tag);
                if (!m) return null;
                return (
                  <li key={tag} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-2.5">
                    <span className="rounded border border-line px-1.5 font-mono text-[11px]">{tag}</span>
                    <span className={`font-mono text-[11px] ${LEVEL_TONE[m.level]}`}>{m.level}</span>
                    <span className="ml-auto font-mono text-[11px] text-ink-muted">
                      {m.attempts === 0
                        ? "not answered yet"
                        : `${m.attempts - m.misses}/${m.attempts} right${m.confident ? "" : " · thin evidence"}`}
                    </span>
                  </li>
                );
              })}
            </ul>

            {repo && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
                <p className="font-mono text-[11px] text-ink-muted">
                  practises on {repo.repo}, with hints on
                </p>
                <button
                  onClick={() => practise(module)}
                  disabled={busy !== null}
                  className="cursor-pointer rounded border border-lamp px-4 py-2 font-mono text-xs text-lamp hover:bg-lamp hover:text-bg disabled:opacity-50"
                >
                  {busy === module.title ? "building…" : "work on this →"}
                </button>
              </div>
            )}
          </section>
        ))}

        {data?.capstone && (
          <section className="rounded-md border border-lamp/30 bg-surface">
            <div className="border-b border-line px-5 py-3">
              <p className="font-mono text-xs text-lamp">the capstone</p>
              <h2 className="mt-1 font-display text-lg font-semibold">
                Rebuild {data.capstone.repo}, in this order
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-muted">
                Not a tutorial — your own repo, from nothing, in the order the map says it was
                actually built. The step you cannot start is the part you do not own yet.
              </p>
            </div>
            <ol className="divide-y divide-line/60">
              {data.capstone.steps.map((step, i) => (
                <li key={i} className="px-5 py-4">
                  <div className="flex flex-wrap items-baseline gap-3">
                    <span className="font-mono text-xs text-ink-muted">{String(i + 1).padStart(2, "0")}</span>
                    <p className="font-medium">{step.title}</p>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-ink-muted">{step.detail}</p>
                  {(step.files.length > 0 || step.tags.length > 0) && (
                    <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-ink-muted/80">
                      {step.files.map((file) => (
                        <span key={file} className="text-lamp">
                          {file}
                        </span>
                      ))}
                      {step.tags.map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5 pb-10">
          <StorageNote subject="this path" />
          <div className="flex items-center gap-4">
            <Link href="/review" className="font-mono text-xs text-ink-muted hover:text-lamp">
              what&apos;s due
            </Link>
            <Link href="/shelf" className="font-mono text-xs text-ink-muted hover:text-lamp">
              your shelf →
            </Link>
          </div>
        </footer>
      </main>
    </>
  );
}

/** A bar that admits when it is guessing. */
function Bar({ mastery }: { mastery: { score: number; confident: boolean } }) {
  return (
    <span className="flex shrink-0 items-center gap-2">
      <span aria-hidden className="h-1.5 w-24 overflow-hidden rounded-full bg-line">
        <span
          className={`block h-full rounded-full ${mastery.confident ? "bg-lamp" : "bg-ink-muted/50"}`}
          style={{ width: `${mastery.score}%` }}
        />
      </span>
      <span className="font-mono text-[11px] text-ink-muted">
        {mastery.score}%{mastery.confident ? "" : " · unproven"}
      </span>
    </span>
  );
}
