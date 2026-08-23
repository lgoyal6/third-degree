"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import ReviewLink from "@/components/ReviewLink";
import ShelfLink from "@/components/ShelfLink";
import type { RepoChoice } from "@/app/api/repos/route";

const EXAMPLES = ["shadcn-ui/taxonomy", "steven-tey/precedent"];

const GH_NOTICE: Record<string, string> = {
  denied: "You cancelled the GitHub connection. Pasting a URL still works.",
  state: "That GitHub redirect expired. Connect again.",
  failed: "Couldn't finish the GitHub connection. Try again, or just paste a URL.",
  unavailable: "GitHub connect isn't configured on this deployment.",
};

export default function Start() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [repos, setRepos] = useState<RepoChoice[] | null>(null);
  const [canConnect, setCanConnect] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  async function submit(value: string) {
    const target = value.trim();
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: target }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      router.push(`/map/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  // Connection state is a fetch rather than a cookie read, so this page stays a
  // client component. A 401 also reports whether Connect is worth offering.
  useEffect(() => {
    const gh = new URLSearchParams(window.location.search).get("gh");
    // Strip the param so a refresh doesn't replay the message.
    if (gh) window.history.replaceState({}, "", window.location.pathname);
    (async () => {
      const message = gh ? GH_NOTICE[gh] ?? null : null;
      try {
        const res = await fetch("/api/repos");
        const data = await res.json();
        if (res.ok) setRepos(data.repos ?? []);
        else setCanConnect(Boolean(data.available));
      } catch {
        // Offline or blocked: the paste path is unaffected, so say nothing.
      }
      if (message) setNotice(message);
    })();
  }, []);

  const disconnect = useCallback(async () => {
    await fetch("/api/auth/github", { method: "DELETE" });
    setRepos(null);
    setCanConnect(true);
    setNotice("GitHub disconnected.");
  }, []);

  const shown = (repos ?? []).filter((r) =>
    filter.trim() ? r.fullName.toLowerCase().includes(filter.trim().toLowerCase()) : true,
  );

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-xl text-center">
        <p className="mb-4 font-mono text-sm text-ink-muted">the interrogation room for your own code</p>
        <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">
          Third Degree
        </h1>
        <p className="mt-3 text-ink-muted">You built it. Now own it.</p>

        <form
          className="mt-10"
          onSubmit={(e) => {
            e.preventDefault();
            submit(url);
          }}
        >
          <label htmlFor="repo" className="sr-only">
            GitHub repository
          </label>
          <div className="flex gap-2">
            <input
              id="repo"
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="github.com/you/that-repo-you-shipped"
              autoComplete="off"
              spellCheck={false}
              className="flex-1 rounded border border-line bg-surface px-4 py-3 font-mono text-sm text-ink placeholder:text-ink-muted/60 focus-visible:outline-offset-0"
            />
            <button
              type="submit"
              disabled={busy}
              className="cursor-pointer rounded bg-lamp px-5 py-3 font-medium text-bg transition-colors duration-150 hover:bg-lamp-bright disabled:opacity-60"
            >
              {busy ? "Opening…" : "Map it"}
            </button>
          </div>
          <p className="mt-3 text-sm text-ink-muted">
            {error ? (
              <span className="text-err">{error}</span>
            ) : (
              "Paste any public GitHub repo. No signup."
            )}
          </p>
        </form>

        {notice && <p className="mt-4 font-mono text-xs text-lamp">{notice}</p>}

        {/* Private repos need GitHub's coarse `repo` scope, so this is never
            required and never automatic. */}
        {canConnect && repos === null && (
          <div className="mt-10">
            <a
              href="/api/auth/github"
              className="inline-block rounded border border-line px-4 py-2 font-mono text-xs text-ink-muted hover:border-lamp hover:text-ink"
            >
              connect github for private repos
            </a>
            <p className="mx-auto mt-3 max-w-sm text-xs leading-relaxed text-ink-muted/80">
              GitHub has no read-only scope for private repos, so the consent screen asks for read
              and write. The token stays on the server and dies when you disconnect.
            </p>
          </div>
        )}

        {repos !== null && (
          <div className="fade-up mt-10 overflow-hidden rounded-md border border-line bg-surface text-left">
            <div className="flex items-baseline justify-between gap-4 border-b border-line px-4 py-2.5">
              <p className="font-mono text-xs text-lamp">
                your repos <span className="text-ink-muted">{repos.length}</span>
              </p>
              <button
                onClick={disconnect}
                className="cursor-pointer font-mono text-xs text-ink-muted hover:text-lamp"
              >
                disconnect
              </button>
            </div>

            {repos.length > 8 && (
              <div className="flex items-center gap-2 border-b border-line/60 px-4 py-2">
                <span aria-hidden className="font-mono text-xs text-lamp">
                  /
                </span>
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="filter by name"
                  aria-label="Filter your repositories"
                  className="w-full bg-transparent font-mono text-xs text-ink placeholder:text-ink-muted/50 focus:outline-none"
                />
              </div>
            )}

            <div className="relative">
              <div className="max-h-56 overflow-y-auto">
                {shown.length === 0 ? (
                  <p className="px-4 py-6 font-mono text-xs text-ink-muted">
                    {repos.length === 0 ? "No repos on this account." : "No repo matches that."}
                  </p>
                ) : (
                  shown.map((r) => (
                  <button
                    key={r.fullName}
                    onClick={() => submit(r.fullName)}
                    disabled={busy}
                    className="flex w-full items-center gap-3 border-l-2 border-transparent px-4 py-2 text-left transition-colors duration-100 hover:border-lamp hover:bg-surface-2 disabled:opacity-60"
                  >
                    <span className="flex-1 truncate font-mono text-xs">{r.fullName}</span>
                    {r.private && (
                      <span className="rounded border border-lamp/40 px-1.5 font-mono text-[10px] uppercase tracking-wide text-lamp">
                        private
                      </span>
                    )}
                    <span className="w-20 shrink-0 text-right font-mono text-[11px] text-ink-muted/70">
                      {r.language ?? ""}
                    </span>
                  </button>
                  ))
                )}
              </div>
              {shown.length > 7 && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-surface to-transparent"
                />
              )}
            </div>
          </div>
        )}

        <div
          className={`mt-12 flex items-center justify-center gap-2 text-sm ${repos !== null ? "hidden" : ""}`}
        >
          <span className="text-ink-muted">try:</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => {
                setUrl(ex);
                submit(ex);
              }}
              className="cursor-pointer rounded-full border border-line bg-surface px-3 py-1 font-mono text-xs text-ink-muted transition-colors duration-150 hover:border-lamp hover:text-lamp"
            >
              {ex}
            </button>
          ))}
        </div>

        <div className="mt-12 flex items-center justify-center gap-5">
          <ShelfLink />
          <ReviewLink />
        </div>
      </div>
    </main>
  );
}
