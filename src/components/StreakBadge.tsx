"use client";

import { useEffect, useState } from "react";
import { PROGRESS_EVENT, readProgress, type Progress } from "@/lib/progress";

/**
 * The whole progress surface: no stats screen, per §7's warning about
 * resembling a dashboard. Renders nothing until there is something to show, so
 * a first-time visitor never meets a zero.
 */
export default function StreakBadge() {
  const [progress, setProgress] = useState<Progress | null>(null);

  // Read after mount: localStorage does not exist during the server render.
  useEffect(() => {
    const sync = () => setProgress(readProgress());
    sync();
    window.addEventListener(PROGRESS_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(PROGRESS_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  if (!progress || (progress.current === 0 && progress.points === 0)) return null;

  return (
    <span
      className="font-mono text-xs text-ink-muted"
      aria-label={`${progress.current} day streak, ${progress.points} points`}
    >
      <span className="text-lamp">{progress.current}</span>-day streak ·{" "}
      <span className="text-lamp">{progress.points}</span> pts
    </span>
  );
}
