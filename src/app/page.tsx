"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { RepoChoice } from "@/app/api/repos/route";

const EXAMPLES = ["shadcn-ui/taxonomy", "steven-tey/precedent"];

const GH_NOTICE: Record<string, string> = {
  connected: "GitHub connected. Your repos are below, private ones included.",
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
    <main className="lamp-glow flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-xl text-center">
        <p className="font-mono text-sm text-lamp mb-4">the interrogation room for your own code</p>
        <h1 className="font-display text-6xl sm:text-7xl font-bold tracking-tight">
          Third Degree
        </h1>
        <p className="mt-4 text-lg text-ink-muted">
          You built it. Now own it.
        </p>

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
              className="flex-1 rounded-lg border border-line bg-surface px-4 py-3 font-mono text-sm text-ink placeholder:text-ink-muted/60"
            />
            <button
              type="submit"
              disabled={busy}
              className="cursor-pointer rounded-lg bg-lamp px-5 py-3 font-medium text-bg transition-colors duration-150 hover:bg-lamp-bright disabled:opacity-60"
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
          <div className="mt-8 border-t border-line/60 pt-6">
            <a
              href="/api/auth/github"
              className="inline-block rounded-lg border border-line px-5 py-2.5 font-medium hover:border-lamp"
            >
              Connect GitHub
            </a>
            <p className="mx-auto mt-3 max-w-md text-xs text-ink-muted">
              Only needed for private repos. GitHub offers no read-only scope for them, so the
              consent screen will ask for read and write access. The token stays on the server and
              is dropped when you disconnect.
            </p>
          </div>
        )}

        {repos !== null && (
          <div className="mt-8 border-t border-line/60 pt-6 text-left">
            <div className="flex items-baseline justify-between gap-4">
              <p className="font-mono text-xs text-ink-muted">your repos</p>
              <button
                onClick={disconnect}
                className="cursor-pointer font-mono text-xs text-ink-muted hover:text-lamp"
              >
                disconnect
              </button>
            </div>
            {repos.length > 8 && (
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="filter"
                className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs placeholder:text-ink-muted/60"
              />
            )}
            <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-line bg-surface">
              {shown.length === 0 ? (
                <p className="p-4 font-mono text-xs text-ink-muted">
                  {repos.length === 0 ? "No repos on this account." : "Nothing matches."}
                </p>
              ) : (
                shown.map((r) => (
                  <button
                    key={r.fullName}
                    onClick={() => submit(r.fullName)}
                    disabled={busy}
                    className="flex w-full items-baseline justify-between gap-3 border-b border-line/50 px-4 py-2.5 text-left last:border-0 hover:bg-surface-2 disabled:opacity-60"
                  >
                    <span className="font-mono text-xs">{r.fullName}</span>
                    <span className="flex items-baseline gap-2 font-mono text-xs text-ink-muted">
                      {r.language && <span>{r.language}</span>}
                      {r.private && <span className="text-lamp">private</span>}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        <div className="mt-12 flex items-center justify-center gap-2 text-sm">
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
      </div>
    </main>
  );
}
