"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import StatusLine from "@/components/StatusLine";
import StreakBadge from "@/components/StreakBadge";
import { isDue, mastery, readCards, REVIEW_EVENT, type ReviewCard } from "@/lib/review";

const MASTERY_TONE: Record<string, string> = {
  shaky: "text-err",
  "coming back": "text-attention",
  solid: "text-ok",
};

export default function ReviewQueue() {
  const [cards, setCards] = useState<ReviewCard[] | null>(null);

  // After mount: localStorage does not exist during the server render.
  useEffect(() => {
    const sync = () => setCards(readCards());
    sync();
    window.addEventListener(REVIEW_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(REVIEW_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const due = (cards ?? []).filter(isDue).sort((a, b) => b.misses - a.misses);
  const later = (cards ?? []).filter((c) => !isDue(c)).sort((a, b) => a.due.localeCompare(b.due));

  return (
    <>
      <StatusLine repo="review" branch={`${(cards ?? []).length} concepts`}>
        {due.length > 0 && <span className="text-lamp">{due.length} due</span>}
        <StreakBadge />
      </StatusLine>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-10">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">What you got wrong</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-muted">
            Every miss is filed under the idea it tested, not the file it came from. Get the same
            idea right in another repo and it moves out; miss it again and it comes straight back.
          </p>
        </div>

        {cards !== null && cards.length === 0 && (
          <div className="rounded-md border border-line bg-surface p-8">
            <p>Nothing waiting. Miss a question and the concept lands here.</p>
            <Link
              href="/"
              className="mt-5 inline-block rounded bg-lamp px-5 py-2.5 font-medium text-bg hover:bg-lamp-bright"
            >
              Map a repo
            </Link>
          </div>
        )}

        {due.length > 0 && (
          <Section
            label="due now"
            note="Next grilling that touches one of these is the retest."
            cards={due}
          />
        )}
        {later.length > 0 && <Section label="coming back" cards={later} />}

        {cards !== null && cards.length > 0 && (
          <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5">
            <p className="max-w-sm font-mono text-[11px] leading-relaxed text-ink-muted/70">
              Kept in this browser, like your streak. Clear the cache and the queue goes with it.
            </p>
            <Link href="/" className="font-mono text-xs text-ink-muted hover:text-lamp">
              map a repo →
            </Link>
          </footer>
        )}
      </main>
    </>
  );
}

function Section({ label, note, cards }: { label: string; note?: string; cards: ReviewCard[] }) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-mono text-xs text-lamp">{label}</h2>
        {note && <p className="font-mono text-[11px] text-ink-muted/70">{note}</p>}
      </div>
      <ol className="mt-3 divide-y divide-line/60 overflow-hidden rounded-md border border-line bg-surface">
        {cards.map((card) => {
          const level = mastery(card);
          return (
            <li key={card.tag} className="px-5 py-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="rounded border border-line px-1.5 font-mono text-xs text-ink">
                  {card.tag}
                </span>
                <span className={`font-mono text-[11px] ${MASTERY_TONE[level]}`}>{level}</span>
                <span className="ml-auto font-mono text-[11px] text-ink-muted">
                  {isDue(card) ? "up next" : `back ${when(card.due)}`}
                </span>
              </div>
              <p className="mt-2 font-mono text-[11px] text-ink-muted">
                missed {card.misses} of {card.attempts} · {card.repos.join(" · ")}
              </p>
              {card.lastPrompt && (
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{card.lastPrompt}</p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Days, not timestamps: the queue is scheduled by date and should read that way. */
function when(due: string): string {
  const [y, m, d] = due.split("-").map(Number);
  const target = new Date(y, (m ?? 1) - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (days <= 1) return "tomorrow";
  if (days <= 6) return `in ${days} days`;
  return `on ${target.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}
