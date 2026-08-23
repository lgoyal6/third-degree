"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { dueTags, readCards, REVIEW_EVENT } from "@/lib/review";

/**
 * The only way into the Review screen. Renders nothing until there is
 * something to review, so a first-time visitor never meets an empty queue
 * (§7: never a blank page).
 */
export default function ReviewLink({ className = "" }: { className?: string }) {
  const [counts, setCounts] = useState<{ total: number; due: number } | null>(null);

  useEffect(() => {
    const sync = () => {
      const cards = readCards();
      setCounts({ total: cards.length, due: dueTags(cards).length });
    };
    sync();
    window.addEventListener(REVIEW_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(REVIEW_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  if (!counts || counts.total === 0) return null;

  return (
    <Link href="/review" className={`font-mono text-xs text-ink-muted hover:text-lamp ${className}`}>
      {counts.due > 0 ? (
        <>
          <span className="text-lamp">{counts.due}</span> due for review
        </>
      ) : (
        "review your misses"
      )}
    </Link>
  );
}
