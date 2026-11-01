"use client";

import { useState } from "react";

export default function DemoLesson() {
  const [choice, setChoice] = useState<number | null>(null);
  return <section className="mt-10 rounded border border-line bg-surface p-6">
    <p className="font-mono text-xs text-lamp">Sample lesson / serverless state</p>
    <h2 className="mt-3 text-xl font-semibold">Why does Third Degree keep map jobs in Redis?</h2>
    <p className="mt-2 text-sm text-ink-muted">The request starts indexing, then the browser polls for progress. Those requests may reach different server instances.</p>
    <div className="mt-4 flex flex-col gap-2">
      {["To share durable progress across server instances", "To make GitHub repositories public", "To avoid parsing source files"].map((answer, index) =>
        <button key={answer} type="button" aria-pressed={choice === index} onClick={() => setChoice(index)} className="rounded border border-line px-4 py-3 text-left hover:border-lamp">
          {answer}
        </button>)}
    </div>
    {choice !== null && <p role="status" className="mt-4 text-sm text-lamp">
      {choice === 0 ? "Correct. A poll can reach another instance, so a process-local object cannot reliably hold the job. Redis stores the shared progress." : "Try again. Follow the job from POST /api/map to GET /api/map/[id]. The important boundary is between server instances."}
    </p>}
    <details className="mt-5 text-sm"><summary className="cursor-pointer">Inspect the implementation</summary>
      <p className="mt-3">src/lib/jobs.ts saves each job with a seven-day TTL. src/app/api/map/route.ts starts the work, and src/app/api/map/[id]/route.ts reads it for polling.</p>
      <a className="text-lamp underline" href="https://github.com/lgoyal6/third-degree/blob/main/src/lib/jobs.ts">Read the source</a>
    </details>
    <p className="mt-5 text-xs text-ink-muted">This is an authored sample lesson with local feedback. Arbitrary repository indexing and AI-generated lessons use the separate live workflow.</p>
  </section>;
}
