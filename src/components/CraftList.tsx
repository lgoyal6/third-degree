"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import StatusLine from "@/components/StatusLine";
import StreakBadge from "@/components/StreakBadge";
import type { CraftItem } from "@/lib/types";

const CATEGORY: Record<CraftItem["category"], string> = {
  ui: "interface",
  accessibility: "accessibility",
  states: "empty & error states",
  hardening: "production",
};

interface Payload {
  craft: CraftItem[];
  repo: { owner: string; name: string; defaultBranch: string };
}

/**
 * §7's Craft screen: the upgrade list, each item a before/after diff. Nothing
 * here is applied for them — §10a keeps that out of v1 deliberately, so the
 * diff is the deliverable and the copy button is the whole workflow.
 */
export default function CraftList({ jobId }: { jobId: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(`/api/map/${jobId}/craft`);
        const body = await res.json();
        if (!live) return;
        if (!res.ok) setError(body.error ?? "Couldn't read the repo.");
        else setData(body);
      } catch {
        if (live) setError("Couldn't reach the server.");
      }
    })();
    return () => {
      live = false;
    };
  }, [jobId]);

  if (error) {
    return (
      <Shell>
        <div className="rounded-md border border-line bg-surface p-8">
          <p>{error}</p>
          <Link
            href={`/map/${jobId}`}
            className="mt-5 inline-block rounded bg-lamp px-5 py-2.5 font-medium text-bg hover:bg-lamp-bright"
          >
            Back to the map
          </Link>
        </div>
      </Shell>
    );
  }

  if (!data) {
    return (
      <Shell>
        <div className="rounded-md border border-lamp/30 bg-surface p-8 text-center">
          <p className="pulse-soft font-mono text-sm text-lamp">
            Reading your code for what to do next…
          </p>
        </div>
        <div aria-hidden className="pulse-soft h-64 rounded-md border border-line/60 bg-surface/50" />
      </Shell>
    );
  }

  return (
    <>
      <StatusLine repo={`${data.repo.owner}/${data.repo.name}`} branch={data.repo.defaultBranch}>
        <span className="text-ink-muted">
          {data.craft.length} upgrade{data.craft.length === 1 ? "" : "s"}
        </span>
        <StreakBadge />
      </StatusLine>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-10">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">The upgrade list</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-muted">
            Every one of these is a diff against a block that is really in your repo, not advice
            about code in general. Nothing is applied for you: read it, take what you agree with.
          </p>
        </div>

        {data.craft.length === 0 ? (
          <div className="rounded-md border border-line bg-surface p-8">
            <p>Nothing to show for this repo.</p>
            <p className="mt-2 text-sm text-ink-muted">
              An upgrade only makes the list when the block it rewrites is found verbatim in your
              files, and none survived that check here.
            </p>
            <Link
              href={`/map/${jobId}`}
              className="mt-5 inline-block rounded bg-lamp px-5 py-2.5 font-medium text-bg hover:bg-lamp-bright"
            >
              Back to the map
            </Link>
          </div>
        ) : (
          <ol className="flex flex-col gap-6">
            {data.craft.map((item, i) => (
              <Item key={i} item={item} />
            ))}
          </ol>
        )}

        <footer className="flex items-center gap-5 border-t border-line pt-5 pb-10">
          <Link href={`/map/${jobId}`} className="font-mono text-xs text-ink-muted hover:text-lamp">
            back to the map
          </Link>
          <Link href="/" className="font-mono text-xs text-ink-muted hover:text-lamp">
            map another repo
          </Link>
        </footer>
      </main>
    </>
  );
}

function Item({ item }: { item: CraftItem }) {
  const [copied, setCopied] = useState(false);
  return (
    <li className="overflow-hidden rounded-md border border-line bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line px-5 py-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="rounded border border-line px-1.5 font-mono text-[11px] text-lamp">
            {CATEGORY[item.category]}
          </span>
          <span className="font-mono text-xs text-ink-muted">
            {item.file}:{item.startLine}
          </span>
        </div>
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(item.after);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="cursor-pointer font-mono text-xs text-ink-muted hover:text-lamp"
        >
          {copied ? "copied" : "copy the new version"}
        </button>
      </div>

      <p className="px-5 py-4 leading-relaxed">{item.rationale}</p>

      <div className="overflow-x-auto border-t border-line font-mono text-xs leading-relaxed">
        <Block lines={item.before.split("\n")} sign="-" tone="err" startLine={item.startLine} />
        <Block lines={item.after.split("\n")} sign="+" tone="ok" />
      </div>
    </li>
  );
}

/** Their lines, then the replacement. Numbered only where numbers are real. */
function Block({
  lines,
  sign,
  tone,
  startLine,
}: {
  lines: string[];
  sign: "-" | "+";
  tone: "err" | "ok";
  startLine?: number;
}) {
  // Removed lines read as the past: dimmer, tinted red. The replacement is
  // what they act on, so it gets full-strength ink.
  const wash = tone === "err" ? "bg-err/10" : "bg-ok/10";
  const ink = tone === "err" ? "text-err" : "text-ok";
  const text = tone === "err" ? "text-ink-muted/70" : "text-ink";
  return (
    <div className={wash}>
      {lines.map((line, i) => (
        <div key={i} className="flex w-max min-w-full">
          <span aria-hidden className="w-10 shrink-0 select-none pr-2 text-right text-ink-muted/40">
            {startLine !== undefined ? startLine + i : ""}
          </span>
          <span aria-hidden className={`w-4 shrink-0 select-none ${ink}`}>
            {sign}
          </span>
          <span className={`whitespace-pre pr-5 ${text}`}>{line || " "}</span>
        </div>
      ))}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">{children}</main>
  );
}
