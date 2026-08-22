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
    <main className="lamp-glow flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-lg text-center">
        <p className="font-mono text-xs text-ink-muted">third degree · the verdict</p>
        <h1 className="font-display mt-3 text-2xl font-semibold">
          {session.repo.owner}
          <span className="text-ink-muted">/</span>
          {session.repo.name}
        </h1>
        <p className="font-display mt-6 text-9xl font-bold text-lamp">{session.score}</p>
        <p className="font-display mt-2 text-2xl font-semibold uppercase tracking-widest">{verdict}</p>
        <p className="mt-2 text-ink-muted">{VERDICT_COPY[verdict]}</p>

        {worst?.q && (
          <div className="mt-8 rounded-xl border border-line bg-surface p-5 text-left">
            <p className="font-mono text-xs text-lamp">the question that did the damage</p>
            <p className="mt-2 text-sm text-ink-muted">{worst.q.prompt.replace(/`/g, "")}</p>
          </div>
        )}

        <div className="mt-10">
          <Link
            href="/"
            className="inline-block rounded-lg bg-lamp px-6 py-3 font-medium text-bg hover:bg-lamp-bright"
          >
            Get grilled on your own repo →
          </Link>
          <p className="mt-3 font-mono text-xs text-ink-muted">paste a repo · 10 questions · no signup</p>
        </div>
      </div>
    </main>
  );
}
