"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import StatusLine from "@/components/StatusLine";
import { ACCOUNT_EVENT, readAccount, writeAccount, type Account } from "@/lib/account/client";
import { readProgress } from "@/lib/progress";
import { readCards } from "@/lib/review";
import { readShelf } from "@/lib/shelf";

const MAX_FOCUS = 5;

/**
 * §10a's profile, as much of it as this product can honestly hold: the name
 * comes from GitHub, the school is optional free text because not everyone is
 * at one, and "topic selection" is a handful of concepts picked from the tags
 * their own answers produced rather than from a curriculum nobody wrote.
 */
export default function AccountView() {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [ready, setReady] = useState(false);
  const [school, setSchool] = useState("");
  const [focus, setFocus] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const sync = () => {
      const next = readAccount();
      setAccount(next);
      setSchool(next?.profile.school ?? "");
      setFocus(next?.profile.focus ?? []);
      setReady(true);
    };
    sync();
    window.addEventListener(ACCOUNT_EVENT, sync);
    return () => window.removeEventListener(ACCOUNT_EVENT, sync);
  }, []);

  const save = useCallback(
    async (nextFocus = focus, nextSchool = school) => {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ school: nextSchool, focus: nextFocus }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const current = readAccount();
      if (current) writeAccount({ ...current, profile: data.profile });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
    [focus, school],
  );

  const signOut = useCallback(async () => {
    await fetch("/api/auth/github", { method: "DELETE" });
    writeAccount(null);
    router.push("/");
  }, [router]);

  const wipe = useCallback(async () => {
    await fetch("/api/me", { method: "DELETE" });
    writeAccount(null);
    router.push("/");
  }, [router]);

  if (!ready) return null;

  if (!account) {
    return (
      <>
        <StatusLine repo="account" />
        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10">
          <h1 className="font-display text-2xl font-semibold tracking-tight">No account here</h1>
          <p className="max-w-lg text-sm leading-relaxed text-ink-muted">
            Everything works without one: the map, the grilling, the queue and the shelf all live in
            this browser. An account only means they survive a cache clear and follow you to another
            machine.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <a
              href="/api/auth/github?scope=identity"
              className="rounded bg-lamp px-5 py-2.5 font-medium text-bg hover:bg-lamp-bright"
            >
              Sign in with GitHub
            </a>
            <Link href="/" className="font-mono text-xs text-ink-muted hover:text-lamp">
              back to the start
            </Link>
          </div>
          <p className="max-w-lg font-mono text-[11px] leading-relaxed text-ink-muted/70">
            Signing in asks GitHub for your name and nothing else. Reading private repos is a
            separate, wider permission you can grant later, or never.
          </p>
        </main>
      </>
    );
  }

  // Their own vocabulary: the tags their answers have actually produced.
  const known = [...new Set(readCards().map((c) => c.tag))].slice(0, 40);
  const progress = readProgress();
  const shelf = readShelf();

  return (
    <>
      <StatusLine repo={`@${account.login}`} branch={account.scope === "repos" ? "private repos connected" : "signed in"}>
        <span className="text-ink-muted">{saved ? "saved" : ""}</span>
      </StatusLine>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-10">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Your account</h1>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-ink-muted">
            Kept on the server now, not just in this browser: {progress?.current ?? 0}-day streak,{" "}
            {progress?.points ?? 0} points, {readCards().length} concepts in the queue,{" "}
            {shelf.length} repo{shelf.length === 1 ? "" : "s"} on the shelf.
          </p>
        </div>

        <section className="rounded-md border border-line bg-surface p-6">
          <label htmlFor="school" className="font-mono text-xs text-lamp">
            school or company
          </label>
          <input
            id="school"
            value={school}
            onChange={(e) => setSchool(e.target.value)}
            onBlur={() => void save()}
            placeholder="optional"
            maxLength={80}
            className="mt-2 w-full rounded border border-line bg-bg px-3 py-2 font-mono text-sm placeholder:text-ink-muted/50"
          />

          <p className="mt-6 font-mono text-xs text-lamp">what to lean on</p>
          <p className="mt-1 text-sm text-ink-muted">
            Up to {MAX_FOCUS} concepts to push on in new sessions, on top of whatever is due. These
            are the tags your own answers produced — there is no syllabus to pick from.
          </p>
          {known.length === 0 ? (
            <p className="mt-3 font-mono text-xs text-ink-muted/70">
              Nothing yet. Miss a question and its concept lands here.
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {known.map((tag) => {
                const on = focus.includes(tag);
                return (
                  <button
                    key={tag}
                    onClick={() => {
                      const next = on
                        ? focus.filter((t) => t !== tag)
                        : focus.length >= MAX_FOCUS
                          ? focus
                          : [...focus, tag];
                      setFocus(next);
                      void save(next);
                    }}
                    className={`cursor-pointer rounded border px-2 py-1 font-mono text-[11px] ${
                      on ? "border-lamp text-lamp" : "border-line text-ink-muted hover:border-lamp"
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-line bg-surface px-6 py-4">
          <div>
            <p className="text-sm">Signed in with GitHub as @{account.login}</p>
            <p className="mt-1 font-mono text-[11px] text-ink-muted">
              {account.scope === "repos"
                ? "read and write on your repos, which is what private ones cost"
                : "name only · private repos would need a wider permission"}
            </p>
          </div>
          <div className="flex items-center gap-4">
            {account.scope !== "repos" && (
              <a
                href="/api/auth/github?scope=repos"
                className="font-mono text-xs text-ink-muted hover:text-lamp"
              >
                connect private repos
              </a>
            )}
            <button onClick={signOut} className="cursor-pointer font-mono text-xs text-ink-muted hover:text-lamp">
              sign out
            </button>
          </div>
        </section>

        <section className="rounded-md border border-err/30 bg-surface px-6 py-4">
          {confirming ? (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm">
                Delete the streak, the queue, the shelf and the account itself? The maps stay until
                they expire on their own.
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setConfirming(false)}
                  className="cursor-pointer font-mono text-xs text-ink-muted hover:text-lamp"
                >
                  keep it
                </button>
                <button
                  onClick={wipe}
                  className="cursor-pointer rounded bg-err px-4 py-2 font-mono text-xs text-bg"
                >
                  delete everything
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="cursor-pointer font-mono text-xs text-err hover:opacity-80"
            >
              delete my account and everything in it
            </button>
          )}
        </section>

        <footer className="flex items-center gap-5 pb-10">
          <Link href="/path" className="font-mono text-xs text-ink-muted hover:text-lamp">
            your path
          </Link>
          <Link href="/" className="font-mono text-xs text-ink-muted hover:text-lamp">
            back to the start
          </Link>
        </footer>
      </main>
    </>
  );
}
