"use client";

import { useEffect, useRef } from "react";
import { hydrateProgress, PROGRESS_EVENT, readProgress } from "@/lib/progress";
import { hydrateCards, readCards, REVIEW_EVENT } from "@/lib/review";
import { hydrateShelf, readShelf, SHELF_EVENT } from "@/lib/shelf";
import { mergeCards, mergeProgress, mergeShelf } from "@/lib/account/merge";
import { writeAccount } from "@/lib/account/client";

const PUSH_DELAY_MS = 2_000;

/**
 * Keeps the browser's copy and the account's copy the same thing (§10a).
 *
 * The local record stays the working copy every screen reads, and the account
 * is its durable mirror: on load the two are merged and the result written
 * both ways, and later changes are pushed after a pause. Merging rather than
 * replacing is what makes signing in safe — a month of anonymous work is not
 * something to trade for an account.
 */
export default function AccountSync() {
  const paused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signedIn = useRef(false);

  useEffect(() => {
    let live = true;

    const push = async () => {
      if (!signedIn.current) return;
      try {
        await fetch("/api/me", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            progress: readProgress(),
            review: readCards(),
            shelf: readShelf(),
          }),
        });
      } catch {
        // Offline: the local copy is unaffected and the next change retries.
      }
    };

    const schedule = () => {
      if (paused.current || !signedIn.current) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void push(), PUSH_DELAY_MS);
    };

    (async () => {
      let data: {
        signedIn?: boolean;
        user?: { login: string; avatarUrl?: string };
        scope?: "identity" | "repos";
        state?: {
          progress: Parameters<typeof hydrateProgress>[0];
          review: Parameters<typeof hydrateCards>[0];
          shelf: Parameters<typeof hydrateShelf>[0];
          profile: { school?: string; focus?: string[] };
        };
      };
      try {
        const res = await fetch("/api/me");
        data = await res.json();
      } catch {
        return; // offline, or the server is down: local carries on alone
      }
      if (!live) return;

      if (!data.signedIn || !data.user || !data.state) {
        writeAccount(null);
        return;
      }
      signedIn.current = true;
      writeAccount({
        login: data.user.login,
        avatarUrl: data.user.avatarUrl,
        scope: data.scope ?? "identity",
        profile: data.state.profile ?? {},
      });

      // Adopt the merge locally before pushing it, so the events this fires do
      // not race the request that follows.
      paused.current = true;
      hydrateProgress(mergeProgress(readProgress(), data.state.progress));
      hydrateCards(mergeCards(readCards(), data.state.review));
      hydrateShelf(mergeShelf(readShelf(), data.state.shelf));
      paused.current = false;
      await push();
    })();

    window.addEventListener(PROGRESS_EVENT, schedule);
    window.addEventListener(REVIEW_EVENT, schedule);
    window.addEventListener(SHELF_EVENT, schedule);
    return () => {
      live = false;
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener(PROGRESS_EVENT, schedule);
      window.removeEventListener(REVIEW_EVENT, schedule);
      window.removeEventListener(SHELF_EVENT, schedule);
    };
  }, []);

  return null;
}
