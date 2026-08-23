"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import StatusLine from "@/components/StatusLine";
import StreakBadge from "@/components/StreakBadge";
import StorageNote from "@/components/StorageNote";
import { readShelf, SHELF_EVENT, forget, type ShelfEntry } from "@/lib/shelf";
import { readinessOf, type Readiness } from "@/lib/indexer/readiness";
import { sessionTags } from "@/lib/account/client";
import type { MapJob } from "@/lib/types";

interface Card extends ShelfEntry {
  job?: MapJob;
  readiness?: Readiness;
  gone?: boolean;
}

const TONE: Record<Readiness["label"], string> = {
  thin: "text-ink-muted",
  workable: "text-attention",
  interrogable: "text-lamp",
  deep: "text-ok",
};

const MAX_CRAM = 3;

/**
 * §7 screen 5, the repo shelf: cards showing language, size, commit depth and
 * readiness, sorted by readiness. Selecting two or three starts §10's cram
 * path. The shelf itself is this browser's, since the accounts layer is still
 * deferred (§10a).
 */
export default function ShelfView() {
  const router = useRouter();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      const entries = readShelf();
      if (entries.length === 0) {
        setCards([]);
        return;
      }
      const loaded = await Promise.all(
        entries.map(async (entry): Promise<Card> => {
          try {
            const res = await fetch(`/api/map/${entry.jobId}`);
            if (!res.ok) return { ...entry, gone: true };
            const job: MapJob = await res.json();
            return { ...entry, job, readiness: readinessOf(job.map) };
          } catch {
            return { ...entry, gone: true };
          }
        }),
      );
      if (!live) return;
      // Sorted by readiness, as §7 asks: the repo worth defending is the one
      // that can hold up a conversation.
      setCards(
        loaded.sort((a, b) => (b.readiness?.score ?? -1) - (a.readiness?.score ?? -1)),
      );
    };
    void load();
    const sync = () => void load();
    window.addEventListener(SHELF_EVENT, sync);
    return () => {
      live = false;
      window.removeEventListener(SHELF_EVENT, sync);
    };
  }, []);

  const cram = useCallback(
    async (mode?: "defend") => {
      if (picked.length < 2 || busy) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/cram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobIds: picked, mode, dueTags: sessionTags() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Couldn't set that up.");
        router.push(`/grill/${data.id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't set that up.");
        setBusy(false);
      }
    },
    [busy, picked, router],
  );

  const toggle = (jobId: string) =>
    setPicked((prev) =>
      prev.includes(jobId)
        ? prev.filter((id) => id !== jobId)
        : prev.length >= MAX_CRAM
          ? prev
          : [...prev, jobId],
    );

  return (
    <>
      <StatusLine repo="your shelf" branch={`${cards?.length ?? 0} mapped`}>
        <StreakBadge />
      </StatusLine>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-10">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Your shelf</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-muted">
            Sorted by how interrogable each repo is, which is not the same as how good it is: a
            thin repo just has less to be asked about. Pick two or three to cram them together.
          </p>
        </div>

        {cards?.length === 0 && (
          <div className="rounded-md border border-line bg-surface p-8">
            <p>Nothing on the shelf yet. Map a repo and it lands here.</p>
            <Link
              href="/"
              className="mt-5 inline-block rounded bg-lamp px-5 py-2.5 font-medium text-bg hover:bg-lamp-bright"
            >
              Map a repo
            </Link>
          </div>
        )}

        {cards === null && (
          <div aria-hidden className="pulse-soft h-40 rounded-md border border-line/60 bg-surface/50" />
        )}

        {cards && cards.length > 0 && (
          <ol className="flex flex-col gap-3">
            {cards.map((card) => (
              <Row
                key={card.jobId}
                card={card}
                picked={picked.includes(card.jobId)}
                onToggle={() => toggle(card.jobId)}
              />
            ))}
          </ol>
        )}

        {picked.length > 0 && (
          <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-4 border-t border-line bg-bg/90 py-4 backdrop-blur">
            <p className="font-mono text-xs text-ink-muted">
              {picked.length} selected{picked.length < 2 ? " · pick one more" : ""}
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => cram("defend")}
                disabled={picked.length < 2 || busy}
                className="cursor-pointer font-mono text-xs text-ink-muted hover:text-lamp disabled:opacity-40"
              >
                timed, no help
              </button>
              <button
                onClick={() => cram()}
                disabled={picked.length < 2 || busy}
                className="cursor-pointer rounded bg-lamp px-6 py-2.5 font-medium text-bg hover:bg-lamp-bright disabled:opacity-50"
              >
                {busy ? "Building the session…" : "Cram these →"}
              </button>
            </div>
          </div>
        )}
        {error && <p className="font-mono text-xs text-err">{error}</p>}

        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5 pb-10">
          <StorageNote subject="the shelf" />
          <Link href="/" className="font-mono text-xs text-ink-muted hover:text-lamp">
            map another repo →
          </Link>
        </footer>
      </main>
    </>
  );
}

function Row({
  card,
  picked,
  onToggle,
}: {
  card: Card;
  picked: boolean;
  onToggle: () => void;
}) {
  const map = card.job?.map;
  const language = map?.languages?.[0]?.name;
  const readiness = card.readiness;

  if (card.gone) {
    return (
      <li className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-line/60 bg-surface/40 px-5 py-4">
        <span className="font-mono text-sm text-ink-muted">{card.repo}</span>
        <span className="flex items-center gap-4 font-mono text-xs text-ink-muted">
          map expired
          <button onClick={() => forget(card.jobId)} className="cursor-pointer hover:text-lamp">
            remove
          </button>
        </span>
      </li>
    );
  }

  return (
    <li
      className={`rounded-md border bg-surface transition-colors duration-150 ${
        picked ? "border-lamp" : "border-line"
      }`}
    >
      <div className="flex flex-wrap items-center gap-4 px-5 py-4">
        <button
          onClick={onToggle}
          aria-pressed={picked}
          aria-label={`Select ${card.repo} for a cram session`}
          className={`h-4 w-4 shrink-0 cursor-pointer rounded-sm border ${
            picked ? "border-lamp bg-lamp" : "border-line"
          }`}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-sm">{card.repo}</p>
          <p className="mt-1 font-mono text-[11px] text-ink-muted">
            {[
              language,
              map?.totalFiles !== undefined ? `${map.totalFiles.toLocaleString()} files` : null,
              map?.totalLoc !== undefined ? `${map.totalLoc.toLocaleString()} lines` : null,
              map?.commitDepth ? `${map.commitDepth} commits` : null,
              `mapped ${card.at}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {readiness && (
          <div className="shrink-0 text-right">
            <p className={`font-display text-xl font-semibold leading-none ${TONE[readiness.label]}`}>
              {readiness.score}
            </p>
            <p className="mt-1 font-mono text-[11px] text-ink-muted">{readiness.label}</p>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-4 border-t border-line/60 px-5 py-2.5 font-mono text-xs">
        <Link href={`/map/${card.jobId}`} className="text-ink-muted hover:text-lamp">
          map
        </Link>
        <Link href={`/map/${card.jobId}/lessons`} className="text-ink-muted hover:text-lamp">
          brief & grill
        </Link>
        <Link href={`/map/${card.jobId}/craft`} className="text-ink-muted hover:text-lamp">
          upgrades
        </Link>
      </div>
    </li>
  );
}
