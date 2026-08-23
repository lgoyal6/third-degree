"use client";

import { useCallback, useRef, useState } from "react";

interface Line {
  from: "you" | "duck";
  text: string;
}

const RUNGS = 4;

/**
 * The §6 escalation ladder, opened from a wrong answer. Four rungs, never
 * skipped, each one paid for with a sentence of your own thinking: saying what
 * you think earns a sharper hint at the same rung, and only "show me more"
 * descends. The answer lives at rung 4 and nowhere earlier.
 */
export default function HintLadder({
  sessionId,
  questionId,
  onFinished,
  finishLabel = "Next question ⏎",
}: {
  sessionId: string;
  questionId: string;
  onFinished: () => void;
  /** Learn mode works the ladder on the live question, so finishing goes back to it. */
  finishLabel?: string;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [rung, setRung] = useState(1);
  // How many times they have asked at this rung, so the duck goes deeper
  // rather than restating itself.
  const [pass, setPass] = useState(1);
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  const ask = useCallback(
    async (action: "elaborate" | "descend") => {
      if (busy || answered) return;
      const mine = said.trim();
      if (action === "elaborate" && !mine) {
        setError("Say what you think first — that's the point.");
        box.current?.focus();
        return;
      }
      setBusy(true);
      setError(null);
      const withMine: Line[] = mine ? [...lines, { from: "you" as const, text: mine }] : lines;
      setLines(withMine);
      setSaid("");
      try {
        const res = await fetch(`/api/grill/${sessionId}/hint`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId, rung, said: mine, action, pass, transcript: withMine }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "The duck is stuck.");
        setLines([...withMine, { from: "duck", text: data.text }]);
        setPass(data.rung === rung ? pass + 1 : 1);
        setRung(data.rung);
        if (data.isAnswer) setAnswered(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "The duck is stuck.");
      } finally {
        setBusy(false);
        setTimeout(() => box.current?.focus(), 0);
      }
    },
    [answered, busy, lines, pass, questionId, rung, said, sessionId],
  );

  return (
    <div className="fade-up rounded-md border border-line bg-surface">
      <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-2.5">
        <p className="font-mono text-xs text-lamp">the duck</p>
        <div className="flex items-center gap-2" aria-label={`Rung ${rung} of ${RUNGS}`}>
          {Array.from({ length: RUNGS }, (_, i) => (
            <span
              key={i}
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full ${i < rung ? "bg-lamp" : "bg-line"}`}
            />
          ))}
          <span className="ml-1 font-mono text-xs text-ink-muted">
            {rung}/{RUNGS}
          </span>
        </div>
      </div>

      <div className="space-y-3 px-5 py-4">
        {lines.length === 0 && (
          <p className="text-sm leading-relaxed text-ink-muted">
            Rubber-duck debugging, backwards: you talk, it asks. Start by saying what you think
            this code does. Nothing you say here changes your score.
          </p>
        )}
        {lines.map((line, i) => (
          <div key={i} className="flex gap-3">
            <span
              className={`shrink-0 select-none font-mono text-xs ${
                line.from === "duck" ? "text-lamp" : "text-ink-muted/60"
              }`}
            >
              {line.from}
            </span>
            <p
              className={`text-sm leading-relaxed ${
                line.from === "duck" ? "" : "font-mono text-xs text-ink-muted"
              }`}
            >
              {line.text}
            </p>
          </div>
        ))}
      </div>

      {answered ? (
        <div className="flex items-center justify-between gap-4 border-t border-line px-5 py-3">
          <p className="font-mono text-xs text-ink-muted">that was the answer</p>
          <button
            onClick={onFinished}
            autoFocus
            className="cursor-pointer rounded bg-lamp px-5 py-2.5 font-medium text-bg hover:bg-lamp-bright"
          >
            {finishLabel}
          </button>
        </div>
      ) : (
        <div className="border-t border-line px-5 py-4">
          <textarea
            ref={box}
            autoFocus
            value={said}
            onChange={(e) => setSaid(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask("elaborate");
              }
            }}
            placeholder={rung === 1 ? "What do you think is happening here?" : "What are you seeing now?"}
            rows={3}
            className="w-full resize-none rounded border border-line bg-bg p-3 font-mono text-sm placeholder:text-ink-muted/50"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-xs text-ink-muted">
              {error ? <span className="text-err">{error}</span> : "⏎ send · saying more sharpens the hint"}
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => ask("descend")}
                disabled={busy}
                className="cursor-pointer font-mono text-xs text-ink-muted hover:text-lamp disabled:opacity-60"
              >
                {rung >= RUNGS - 1 ? "just show me" : "show me more"}
              </button>
              <button
                onClick={() => ask("elaborate")}
                disabled={busy}
                className="cursor-pointer rounded bg-lamp px-5 py-2.5 font-medium text-bg hover:bg-lamp-bright disabled:opacity-60"
              >
                {busy ? "Thinking…" : "That's my read"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
