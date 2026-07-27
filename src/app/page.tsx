"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const EXAMPLES = ["shadcn-ui/taxonomy", "steven-tey/precedent"];

export default function Start() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
