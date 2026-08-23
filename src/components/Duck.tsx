"use client";

/**
 * The companion (BUILD_PLAN §6), docked bottom-right in Learn mode per §7.
 * Small, persistent, and non-modal: it never covers the question, never takes
 * focus, and never speaks unless a struggle signal fired or it was asked.
 */
export default function Duck({
  nudge,
  open,
  collapsed,
  onOpen,
  onDismiss,
  onToggle,
}: {
  /** Copy for the struggle signal that fired, if any. */
  nudge?: string | null;
  open: boolean;
  collapsed: boolean;
  onOpen: () => void;
  onDismiss: () => void;
  onToggle: () => void;
}) {
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-30 flex max-w-xs flex-col items-end gap-2">
      {nudge && !open && (
        <div className="fade-up pointer-events-auto rounded-md border border-attention/40 bg-surface p-3 shadow-lg shadow-black/40">
          <p className="text-sm leading-relaxed text-ink">{nudge}</p>
          <div className="mt-3 flex items-center justify-end gap-3">
            <button
              onClick={onDismiss}
              className="cursor-pointer font-mono text-xs text-ink-muted hover:text-lamp"
            >
              not yet
            </button>
            <button
              onClick={onOpen}
              className="cursor-pointer rounded border border-lamp px-3 py-1.5 font-mono text-xs text-lamp hover:bg-lamp hover:text-bg"
            >
              talk it through
            </button>
          </div>
        </div>
      )}

      <button
        onClick={open ? onToggle : onOpen}
        aria-label={open ? (collapsed ? "Show the duck" : "Hide the duck") : "Ask the duck"}
        className="pointer-events-auto flex cursor-pointer items-center gap-2 rounded-full border border-line bg-surface px-3 py-2 text-lamp shadow-lg shadow-black/40 transition-colors duration-150 hover:border-lamp"
      >
        <Mark />
        <span className="font-mono text-[11px] text-ink-muted">
          {open ? (collapsed ? "back to the duck" : "hide") : "? stuck"}
        </span>
      </button>
    </div>
  );
}

/** A duck, at 18px: head, beak, eye, and the water it sits on. */
function Mark() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden className="shrink-0">
      <circle cx="9.8" cy="8.6" r="5.2" fill="currentColor" />
      <path d="M14.6 8.8h5.6l-3.6 2.5a1 1 0 0 1-1.9-.5z" fill="currentColor" />
      <circle cx="8" cy="7.2" r="0.85" fill="var(--surface)" />
      <path
        d="M3 16.9c3.9 2.5 10.6 2.3 14.4-1.4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
        opacity="0.5"
      />
    </svg>
  );
}
