"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CategoryNode, MapJob, RouteInfo, Stage } from "@/lib/types";
import DepGraph from "@/components/DepGraph";
import StreakBadge from "@/components/StreakBadge";

const STAGE_LABELS: [Stage, string][] = [
  ["meta", "Finding the repo"],
  ["clone", "Pulling it in"],
  ["files", "Reading every file"],
  ["stack", "Identifying the stack"],
  ["structure", "Tracing routes & structure"],
  ["schema", "Extracting the data model"],
  ["summary", "Writing the brief"],
];

const POLL_MS = 800;

export default function MapView({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [job, setJob] = useState<MapJob | null>(null);
  const [lost, setLost] = useState(false);
  const [express, setExpress] = useState(false);
  const [expressError, setExpressError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Layer 4: skip the ladder and defend the whole system in one answer.
  const startExpress = useCallback(async () => {
    if (express) return;
    setExpress(true);
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
      setExpress(false);
    }
  }, [express, jobId, router]);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(`/api/map/${jobId}`);
        if (res.status === 404) {
          setLost(true);
          stop();
          return;
        }
        const data: MapJob = await res.json();
        setJob(data);
        if (data.stage === "done" || data.stage === "error") stop();
      } catch {
        // transient network error — keep polling
      }
    };
    poll();
    timer.current = setInterval(poll, POLL_MS);
    return stop;
  }, [jobId, stop]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.push("/");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  if (lost) {
    return (
      <Shell>
        <div className="rounded-xl border border-line bg-surface p-8 text-center">
          <p className="text-lg">This map expired.</p>
          <Link
            href="/"
            className="mt-4 inline-block rounded-lg bg-lamp px-5 py-2.5 font-medium text-bg hover:bg-lamp-bright"
          >
            Map a repo
          </Link>
        </div>
      </Shell>
    );
  }

  const map = job?.map ?? {};
  const stage = job?.stage ?? "queued";

  if (stage === "error") {
    return (
      <Shell>
        <div className="rounded-xl border border-err/40 bg-surface p-8 text-center">
          <p className="font-mono text-sm text-err">{job?.error}</p>
          <Link
            href="/"
            className="mt-5 inline-block rounded-lg bg-lamp px-5 py-2.5 font-medium text-bg hover:bg-lamp-bright"
          >
            Try another repo
          </Link>
        </div>
      </Shell>
    );
  }

  const meta = map.meta;
  const ghBase = meta
    ? `https://github.com/${meta.owner}/${meta.name}/blob/${meta.defaultBranch}`
    : null;

  return (
    <Shell>
      {/* Repo header */}
      {meta ? (
        <header className="fade-up">
          <div className="flex items-baseline justify-between gap-4">
            <p className="font-mono text-xs text-ink-muted">under the lamp</p>
            <StreakBadge />
          </div>
          <h1 className="font-display mt-1 text-4xl font-bold tracking-tight">
            {meta.owner}
            <span className="text-ink-muted">/</span>
            {meta.name}
          </h1>
          {meta.description && <p className="mt-2 text-ink-muted">{meta.description}</p>}
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-ink-muted">
            {map.totalFiles !== undefined && <span>{map.totalFiles.toLocaleString()} files</span>}
            {map.totalLoc !== undefined && <span>{map.totalLoc.toLocaleString()} lines</span>}
            <span>★ {meta.stars.toLocaleString()}</span>
          </div>
        </header>
      ) : (
        <SkeletonBlock h="h-28" label="repo" />
      )}

      {/* Progress rail — physical, not a percentage */}
      {stage !== "done" && (
        <ol className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs" aria-label="Map progress">
          {STAGE_LABELS.map(([s, label]) => {
            const stageIdx = STAGE_LABELS.findIndex(([x]) => x === stage);
            const idx = STAGE_LABELS.findIndex(([x]) => x === s);
            const state = idx < stageIdx ? "done" : idx === stageIdx ? "now" : "todo";
            return (
              <li
                key={s}
                className={
                  state === "done"
                    ? "text-ok"
                    : state === "now"
                      ? "pulse-soft text-lamp"
                      : "text-ink-muted/50"
                }
              >
                {state === "done" ? "✓ " : state === "now" ? "● " : "○ "}
                {label}
              </li>
            );
          })}
        </ol>
      )}

      {/* The blurb — orientation before anything else */}
      {map.summary ? (
        <section className="fade-up lamp-glow rounded-xl border border-lamp/30 bg-surface p-6" aria-label="Summary">
          <p className="font-mono text-xs text-lamp">what this app is</p>
          <p className="mt-2 leading-relaxed">{map.summary.text}</p>
          <p className="mt-4 font-mono text-xs text-lamp">how it&apos;s organized</p>
          <p className="mt-2 leading-relaxed text-ink-muted">{map.summary.structure}</p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <span className="font-mono text-xs text-ink-muted">start reading →</span>
            {ghBase ? (
              <a
                href={`${ghBase}/${map.summary.startHere.file}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-line px-4 py-2 font-mono text-xs hover:border-lamp"
              >
                {map.summary.startHere.file}
              </a>
            ) : (
              <span className="font-mono text-xs">{map.summary.startHere.file}</span>
            )}
            <span className="text-sm text-ink-muted">{map.summary.startHere.reason}</span>
          </div>
        </section>
      ) : (
        <SkeletonBlock h="h-44" label="summary" />
      )}

      {/* Languages */}
      {map.languages ? (
        map.languages.length > 0 && (
          <section className="fade-up" aria-label="Languages">
            <div className="flex h-2 overflow-hidden rounded-full border border-line">
              {map.languages.map((l, i) => (
                <div
                  key={l.name}
                  style={{ width: `${Math.max(l.pct, 2)}%`, opacity: 1 - i * 0.13 }}
                  className="bg-lamp"
                  title={`${l.name} ${l.pct}%`}
                />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-ink-muted">
              {map.languages.map((l) => (
                <span key={l.name}>
                  {l.name} <span className="text-lamp">{l.pct}%</span>
                </span>
              ))}
            </div>
          </section>
        )
      ) : (
        <SkeletonBlock h="h-10" label="languages" />
      )}

      {/* Stack */}
      {map.stack ? (
        <section className="fade-up" aria-label="Stack">
          <SectionTitle>Stack</SectionTitle>
          <div className="mt-3 flex flex-wrap gap-2">
            {map.stack.frameworks.length === 0 && (
              <span className="text-sm text-ink-muted">No recognized frameworks — raw {map.languages?.[0]?.name ?? "code"}.</span>
            )}
            {map.stack.frameworks.map((fw) => (
              <span
                key={fw}
                className="rounded-full border border-line bg-surface px-3 py-1 font-mono text-xs"
              >
                {fw}
              </span>
            ))}
            {map.stack.packageManager && (
              <span className="rounded-full border border-line px-3 py-1 font-mono text-xs text-ink-muted">
                {map.stack.packageManager} · {map.stack.dependencies} deps
              </span>
            )}
          </div>
        </section>
      ) : (
        <SkeletonBlock h="h-16" label="stack" />
      )}

      {/* Structure */}
      {map.categories ? (
        map.categories.length > 0 && (
          <section className="fade-up" aria-label="Structure">
            <SectionTitle>Structure</SectionTitle>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {map.categories.map((c) => (
                <CategoryCard key={c.name} node={c} />
              ))}
            </div>
          </section>
        )
      ) : (
        <SkeletonBlock h="h-48" label="structure" />
      )}

      {/* The wiring — every file, every import */}
      {map.graph ? (
        map.graph.nodes.length > 2 && (
          <section className="fade-up" aria-label="Dependency graph">
            <SectionTitle>
              The wiring{" "}
              <span className="text-ink-muted">
                ({map.graph.nodes.length} files, {map.graph.edges.length} imports)
              </span>
            </SectionTitle>
            <p className="mt-1 text-sm text-ink-muted">
              Hover a file to see what depends on it. The big nodes are your load-bearing walls.
            </p>
            <div className="mt-3">
              <DepGraph nodes={map.graph.nodes} edges={map.graph.edges} ghBase={ghBase} />
            </div>
          </section>
        )
      ) : (
        <SkeletonBlock h="h-96" label="graph" />
      )}

      {/* Routes */}
      {map.routes ? (
        map.routes.length > 0 && (
          <section className="fade-up" aria-label="Routes">
            <SectionTitle>
              Routes <span className="text-ink-muted">({map.routes.length})</span>
            </SectionTitle>
            <div className="mt-3 max-h-80 overflow-y-auto rounded-xl border border-line bg-surface">
              <table className="w-full text-left font-mono text-xs">
                <tbody>
                  {map.routes.map((r, i) => (
                    <RouteRow key={`${r.method}-${r.path}-${i}`} route={r} ghBase={ghBase} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      ) : (
        <SkeletonBlock h="h-40" label="routes" />
      )}

      {/* Data model */}
      {map.models && map.models.length > 0 && (
        <section className="fade-up" aria-label="Data model">
          <SectionTitle>
            Data model <span className="text-ink-muted">({map.models.length})</span>
          </SectionTitle>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {map.models.map((m) => (
              <div key={m.name} className="rounded-xl border border-line bg-surface p-4">
                <p className="font-mono text-sm text-lamp">{m.name}</p>
                <ul className="mt-2 space-y-0.5 font-mono text-xs text-ink-muted">
                  {m.fields.slice(0, 8).map((f) => (
                    <li key={f.name}>
                      {f.name} <span className="opacity-60">{f.type}</span>
                    </li>
                  ))}
                  {m.fields.length > 8 && <li className="opacity-60">…{m.fields.length - 8} more</li>}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* The test — only after they've seen the whole map */}
      {stage === "done" && (
        <section className="fade-up lamp-glow rounded-xl border border-lamp/30 bg-surface p-8 text-center" aria-label="Start the grilling">
          <p className="font-display text-2xl font-semibold">You&apos;ve seen the map.</p>
          <p className="mt-2 text-ink-muted">
            First the stack choices it made, then the questions — climbing from fundamentals to the seams, the
            way an interviewer would.
          </p>
          <Link
            href={`/map/${jobId}/lessons`}
            className="mt-5 inline-block rounded-lg bg-lamp px-7 py-3 font-medium text-bg hover:bg-lamp-bright"
          >
            Brief me, then grill me →
          </Link>
          <p className="mt-3 font-mono text-xs text-ink-muted">
            the choices you made · then ~10 questions · scored · shareable verdict
          </p>
          <div className="mt-6 border-t border-line/60 pt-5">
            <button
              onClick={startExpress}
              disabled={express}
              className="cursor-pointer font-mono text-xs text-ink-muted hover:text-lamp disabled:opacity-60"
            >
              {express ? "clearing the room…" : "or: I already know this repo → one question, one shot"}
            </button>
            {expressError && <p className="mt-2 font-mono text-xs text-err">{expressError}</p>}
          </div>
        </section>
      )}

      <footer className="pb-10 pt-4 text-center">
        <Link href="/" className="font-mono text-xs text-ink-muted hover:text-lamp">
          esc · map another repo
        </Link>
      </footer>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 pt-14">
      {children}
    </main>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-xl font-semibold">{children}</h2>;
}

function SkeletonBlock({ h, label }: { h: string; label: string }) {
  return (
    <div
      aria-hidden
      className={`${h} pulse-soft rounded-xl border border-line/60 bg-surface/50`}
      data-skeleton={label}
    />
  );
}

function CategoryCard({ node }: { node: CategoryNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <p className="font-display font-semibold">{node.name}</p>
        <p className="font-mono text-xs text-ink-muted">
          {node.files} files · {node.loc.toLocaleString()} loc
        </p>
      </div>
      <ul className="mt-3 space-y-1.5">
        {node.children.slice(0, 6).map((sub) => (
          <li key={sub.name} className="flex items-baseline justify-between gap-3 text-sm">
            <span>{sub.name}</span>
            <span className="font-mono text-xs text-ink-muted">{sub.files}</span>
          </li>
        ))}
        {node.children.length > 6 && (
          <li className="font-mono text-xs text-ink-muted">…{node.children.length - 6} more</li>
        )}
      </ul>
    </div>
  );
}

const METHOD_COLOR: Record<string, string> = {
  GET: "text-ok",
  POST: "text-lamp",
  PUT: "text-lamp",
  PATCH: "text-lamp",
  DELETE: "text-err",
  "*": "text-ink-muted",
};

function RouteRow({ route, ghBase }: { route: RouteInfo; ghBase: string | null }) {
  return (
    <tr className="border-b border-line/50 last:border-0">
      <td className={`w-20 px-4 py-2 ${METHOD_COLOR[route.method] ?? "text-ink-muted"}`}>
        {route.kind === "page" ? "PAGE" : route.kind === "middleware" ? "MW" : route.method}
      </td>
      <td className="px-2 py-2">{route.path}</td>
      <td className="px-4 py-2 text-right text-ink-muted">
        {ghBase ? (
          <a href={`${ghBase}/${route.file}`} target="_blank" rel="noreferrer" className="hover:text-lamp">
            {route.file}
          </a>
        ) : (
          route.file
        )}
      </td>
    </tr>
  );
}
