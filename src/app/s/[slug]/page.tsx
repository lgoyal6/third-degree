import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionBySlug } from "@/lib/grill/store";
import { VERDICT_COPY } from "@/lib/grill/types";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const session = await getSessionBySlug(slug);
  if (!session || session.finishedAt === undefined || session.repo.private) {
    return { title: "Third Degree" };
  }
  return {
    title: `${session.score}/100 on ${session.repo.owner}/${session.repo.name} — Third Degree`,
    description: `Verdict: ${session.verdict}. ${VERDICT_COPY[session.verdict ?? "raw"]} Think you'd do better on your own repo?`,
  };
}

export default async function SharePage({ params }: Props) {
  const { slug } = await params;
  const session = await getSessionBySlug(slug);
  // A private repo's questions name real files, so there is no public page for
  // one. The owner still sees the verdict on their own score screen.
  if (!session || session.finishedAt === undefined || session.repo.private) notFound();

  const verdict = session.verdict ?? "raw";
  // The question that hurt the most — the hook for anyone who sees the card
  const worst = [...session.attempts]
    .map((a, i) => ({ a, q: session.questions[i] }))
    .filter((x) => x.a.score !== null)
    .sort((x, y) => (x.a.score ?? 0) - (y.a.score ?? 0))[0];

  return (
    <main className="paper flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-xl">
        <div className="flex items-baseline justify-between gap-4 border-b-2 border-paper-rule pb-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-muted">
            third degree
          </p>
          <p className="font-mono text-xs text-paper-muted">
            {session.repo.owner}/{session.repo.name}
          </p>
        </div>

        <div className="mt-10 flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="font-paper flex items-end gap-2 font-bold leading-none">
              <span className="text-8xl">{session.score}</span>
              <span className="pb-2 text-3xl text-paper-muted">/100</span>
            </p>
            <p className="mt-4 max-w-sm text-paper-muted">{VERDICT_COPY[verdict]}</p>
          </div>
          <p className="-rotate-3 rounded border-2 border-stamp px-4 py-1.5 font-mono text-xl font-semibold uppercase tracking-[0.2em] text-stamp">
            {verdict}
          </p>
        </div>

        {worst?.q && (
          <div className="mt-10 border-t border-paper-rule pt-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-muted">
              the question that did the damage
            </p>
            <p className="mt-2 text-sm">{worst.q.prompt.replace(/`/g, "")}</p>
          </div>
        )}

        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t-2 border-paper-rule pt-6">
          <p className="font-mono text-xs text-paper-muted">
            paste a repo · 10 questions · no signup
          </p>
          <Link
            href="/"
            className="rounded bg-paper-ink px-5 py-2.5 font-medium text-paper hover:opacity-90"
          >
            Get grilled on your own repo →
          </Link>
        </div>
      </div>
    </main>
  );
}
