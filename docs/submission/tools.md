# Tools used to build Third Degree

## AI

- **Claude Code (Opus)** for the build itself: planning, implementation, and the QA passes.
  `BUILD_PLAN.md`, the design spec in `docs/specs/`, and `AGENTS.md` are the working
  artifacts of that loop.
- **Anthropic API, `claude-opus-4-8`** at runtime, via `@anthropic-ai/sdk` with JSON-schema
  structured outputs. Five call sites: the map summary, the Layer 1 snippet
  questions, open-answer groundedness grading, the express feedback line, and the lesson
  deck. Every one has a
  deterministic fallback, so the product runs with no key.
- **agent-browser** CLI for the browser QA passes (clicking through the deck, the express
  path, and the streak rules against both local and production builds).

## Framework and language

- **Next.js 16** (App Router, Server Components, route handlers, `after()` for work that
  outlives the response)
- **React 19**, **TypeScript 5**
- **Tailwind CSS 4** with design tokens in `src/app/globals.css`

## Analysis and rendering

- **Node's `fs` plus `tar`** to stream and unpack the GitHub tarball
- A hand-written import graph (`src/lib/imports.ts`) resolving relative paths,
  `tsconfig`/`jsconfig` aliases, and `require`/dynamic-import forms
- **d3-force** for the dependency graph layout
- **`next/font`** (Bricolage Grotesque, IBM Plex Sans, IBM Plex Mono) and Next's
  `ImageResponse` for the share card OG image

## Infrastructure

- **Vercel** for hosting, Fluid Compute functions, and the git-push production pipeline
- **Upstash Redis**, provisioned through the Vercel Marketplace, for map jobs, grill
  sessions, and rate-limit counters
- **@upstash/ratelimit** for sliding-window per-IP limits on maps, grills, answers, lesson
  decks, and express runs
- **GitHub REST API** for repo metadata and tarball download

## Notes

- `ts-morph` is in `package.json` but is not imported anywhere. It was added for the planned
  symbol-level grading upgrade (BUILD_PLAN M3) and is unused today.
- No component library, no UI kit, no chart library. The graph, the deck, and the score
  screens are hand-built against the design system in `design-system/third-degree/MASTER.md`.
