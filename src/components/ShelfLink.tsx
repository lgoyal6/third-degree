"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readShelf, SHELF_EVENT } from "@/lib/shelf";

/**
 * The way back to §7's repo shelf. Silent until there is a shelf, so a
 * first-time visitor is never offered an empty one.
 */
export default function ShelfLink({ className = "" }: { className?: string }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const sync = () => setCount(readShelf().length);
    sync();
    window.addEventListener(SHELF_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SHELF_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  if (count === 0) return null;

  return (
    <Link href="/shelf" className={`font-mono text-xs text-ink-muted hover:text-lamp ${className}`}>
      your shelf <span className="text-lamp">{count}</span>
    </Link>
  );
}
