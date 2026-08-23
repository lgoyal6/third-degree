"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readCards, REVIEW_EVENT } from "@/lib/review";

/**
 * The way into the derived curriculum. Hidden until there are concepts to build
 * one from, since a path with nothing on it is worse than no path.
 */
export default function PathLink({ className = "" }: { className?: string }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const sync = () => setCount(readCards().length);
    sync();
    window.addEventListener(REVIEW_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(REVIEW_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  if (count < 2) return null;

  return (
    <Link href="/path" className={`font-mono text-xs text-ink-muted hover:text-lamp ${className}`}>
      your path <span className="text-lamp">{count}</span>
    </Link>
  );
}
