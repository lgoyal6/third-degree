# Third Degree

**You built it. Now own it.**

## Why this exists

A generation of developers is shipping repos faster than they can understand them. The projects work, the commits are green, the portfolio looks real - and then an interviewer asks *"walk me through what happens when two requests hit this endpoint at the same time"* and the room goes quiet. Third Degree exists for that moment.

The original aim, unchanged: take a repo you built (probably with heavy AI assistance) and **teach you your own stack through it, then grill you on it until you can defend it in an interview**. It is not a code-review tool, a documentation generator, or a chatbot over your repo - it's a curriculum generated from your own code, with an interrogation at the end. Success is measured in users and community, not revenue; the growth loop is the shareable verdict card ("I scored 37 on a repo I *built*"), and the wedge is interview panic, not a desire to learn.

Full product thesis, milestones, and risk register: [BUILD_PLAN.md](./BUILD_PLAN.md).

## What it does today

1. **Paste any public GitHub repo.** No signup. `owner/repo` or a URL. Optionally connect GitHub, which exists only to reach private repos.
2. **The Map (teach first).** A guided tour renders progressively: what the app is, how it's organized, language/stack breakdown, Frontend/Backend/Data/Infra structure, an **interactive dependency graph** of every file and import (hover a node to see its blast radius), routes with real HTTP methods, and the data model.
3. **The Lesson Deck (the choices you made).** Up to six cards on the stack decisions the repo actually made: what it uses, what it was picked over, why it fits this codebase, what it costs. Every card links to real files, and any card citing a path the map cannot prove is dropped rather than shown. Skippable, resumable, and generated only if you open it.
4. **The Grill (then test).** Up to 10 typed-answer questions that climb a ladder: **fundamentals** (the language and DSA constructs your code actually uses) → **functions** (what this exact code does) → **modules** (which file handles this request, which models it touches) → **seams** (what breaks if you rename this schema field). Visible timer, no hints.
5. **Or the Express Path.** Claim you already know the repo and answer one open question instead of ten. Scored with no model in the loop: hub coverage weighted by import degree, model and route coverage, minus ten points for every file you name that does not exist. Phantom references are the whole point, and the feedback names them.
6. **The Verdict.** A 0–100 score with a doneness rating - *raw / rare / medium / well-done* - a per-question review with the correct answers, and a public share card with an auto-generated OG image. Finishing anything advances a browser-local day streak and point total. Runs on private repos get no public card, since the questions name real files.

## Architecture

The design principle everything hangs off: **ground truth comes from the repo; the LLM phrases questions and grades open answers, but never decides what's true.** A question like "which files break if you rename `User.email`" is generated *and graded* from static analysis - the model can't hallucinate an answer key.

### Map pipeline

`POST /api/map` validates the repo against the GitHub API (150 MB size cap), then runs a staged pipeline fire-and-forget in Vercel's `after()`: tarball fetch and unpack into the function's tmpdir, since there is no `git` binary there → file walk with language/LOC stats → framework detection from manifests → route extraction (Next.js file conventions + AST-adjacent scanning for Express/Hono/Fastify) → path-heuristic categorization → dependency-graph build → data-model extraction (Prisma, Drizzle, SQL DDL, Mongoose) → a structured-output Claude summary with a "start here" pick. Each stage writes partial results; the client polls and renders sections as they land, so something is on screen in seconds. A 176-file repo maps end to end in about 13 seconds on production, including the tarball download. Every LLM call degrades gracefully to a deterministic fallback, so the product works with no API key at all.

### Import graph

A file-level import graph resolves relative imports, `tsconfig`/`jsconfig` path aliases (`@/*`), and `require`/dynamic-import forms against the walked file set. It powers both the map's graph visualization (nodes colored by category and sized by LOC, capped at 120 nodes / 500 edges for readability; categorical palette validated for colorblind separation and contrast against the dark surface) and the grill's blast-radius questions. The planned M3 upgrade swaps file-level edges for symbol-level references via the TypeScript compiler API - the interface is already shaped for it.

### Question engine

Two generator families feed one ladder:

- **Deterministic (Tier 1):** import blast radius (from the graph), schema-field rename impact (word-boundary reference search with a stoplist for generic field names, deduped across models), route-handler location, and route→model reachability (route file plus its direct imports). Ground truth is a file list or name set computed at generation time.
- **LLM-generated (Tier 3):** for the busiest business-logic files, Claude produces a *fundamental* question (the array chain, the `await`, the loop complexity - anchored to that snippet) and a *behavior* question per snippet, via a strict JSON-schema structured output that must include key points, key symbols, and the correct answer.

### Grading

- **Tier 1** answers grade deterministically: F1 over the named-file set (recall of affected files, precision against files named that aren't affected), with guards against false credit - framework-convention basenames like `route.ts` only match when directory-qualified.
- **Layer 4** (the express path) grades with no model at all: coverage of the load-bearing files weighted by import degree, plus models and routes, minus a fixed penalty per invented file. Missing components redistribute their weight, so a route-less repo can still score 100. The model writes the feedback line and never touches the number.
- **Tier 3** answers grade on **groundedness**: does the answer name the actual symbols and hit the key points? The scoring rule is the product's core incentive - *generic-but-correct must lose to specific-and-partial*. "Add caching" scores low; "cache in `getUserFeed`, but `POST /follow` doesn't know the cache exists" scores high. Ungradable answers (no API key) are excluded from the total rather than silently zeroed.

### Sessions, sharing, ops

Map jobs live in Upstash Redis with a seven-day TTL, because serverless instances share no memory and a map URL is a resumable artifact rather than throwaway progress. Grill sessions are persisted with no TTL at all, since share links are the growth loop and must not rot; each carries an unguessable slug serving a public verdict page and an OG card. Ground truth for unanswered questions never leaves the server, and a private repo's session serves no public page.

Abuse controls are in the ingest path: a 150 MB repo cap, per-stage timeouts, and per-IP sliding-window rate limits on every expensive route (maps, grills, answers, lesson decks, express runs). GitHub OAuth tokens live in Redis under a session id with a seven-day TTL; the cookie holds only that id and the token never reaches the client. Still ahead of a real launch: symbol-level grading, and moving indexing onto a queue-fed worker if concurrent load ever demands it.

### Design system

Interrogation-lamp amber on warm charcoal, Bricolage Grotesque / IBM Plex, dark-first, keyboard-first, `prefers-reduced-motion` respected. Tokens and rationale: [design-system/third-degree/MASTER.md](./design-system/third-degree/MASTER.md).

## Status

- ✅ **M0 - the Map** (guided tour, dependency graph, progressive render)
- ✅ **M1 - the Grill** (question ladder, grading, verdict, share card) - *launch milestone*
- ✅ **Deployed on Vercel** with Redis-backed jobs and sessions, per-IP rate limits, and live LLM calls
- ✅ **Lesson deck, express path, browser-local streak, GitHub OAuth for private repos** (Aug 2026; spec in [docs/specs](./docs/specs))
- ⏳ Next, in order: the pseudocode-to-code bridge, sandboxed problems scoped to your own repo, then the identity layer that makes streaks and a curriculum durable (BUILD_PLAN §10a)
- Then: Learn mode (M2) → symbol-level grading substrate (M3) → companion & spaced repetition (M4) → System & Craft layers (M5) → full Defend mode + multi-repo (M6)

## Run it

```bash
npm install
cp .env.example .env.local   # KV_* are required; ANTHROPIC_API_KEY unlocks summaries, lesson cards and LLM-graded questions
npm run dev
```

Open http://localhost:3000, paste a repo, take the tour, then sit down for the grilling.

Stack: Next.js 16 · React 19 · TypeScript · Tailwind 4 · d3-force · Upstash Redis · Vercel · Anthropic API (structured outputs, `claude-opus-4-8`).
