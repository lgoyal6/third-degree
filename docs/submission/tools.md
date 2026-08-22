# Complete list of tools used

Everything that went into building, running, or shipping Third Degree. Versions are what
is actually installed, not what the manifest asks for.

## AI

| Tool | What I used it for |
| --- | --- |
| Claude Code (Opus) | The build itself: planning, implementation, QA passes, and the design work. `BUILD_PLAN.md`, `docs/specs/`, and `AGENTS.md` are the working artifacts of that loop. |
| Anthropic API, model `claude-opus-4-8` | Runtime, through `@anthropic-ai/sdk` with JSON-schema structured outputs. Five call sites: the map summary, the Layer 1 snippet questions, open-answer grading, the express feedback line, and the lesson deck. Every one falls back to deterministic output, so the product runs with no key. |

## Framework and language

| Tool | Version |
| --- | --- |
| Next.js (App Router, Server Components, route handlers, `after()`) | 16.2.12 |
| React / React DOM | 19.2.4 |
| TypeScript | 5.9.3 |
| Tailwind CSS + `@tailwindcss/postcss` | 4.3.3 |
| Node.js | 24.19.0 |
| npm | 12.0.2 |

## Libraries in the product

| Library | Version | What it does here |
| --- | --- | --- |
| `@anthropic-ai/sdk` | 0.115.0 | Structured-output model calls |
| `@upstash/redis` | 1.38.2 | Map jobs, grill sessions, OAuth session tokens |
| `@upstash/ratelimit` | 2.0.8 | Per-IP sliding windows on maps, grills, answers, decks, express runs |
| `tar` | 7.5.22 | Unpacking the GitHub tarball into the function's tmpdir |
| `d3-force` | 3.0.0 | Layout for the dependency graph |
| `ts-morph` | 28.0.0 | Declared but **not imported anywhere**. Added for the planned symbol-level grading upgrade and unused today. |

Everything else is hand-written: the import graph resolver, the route and data-model
extractors, the question generators, the graders, and every component. No UI kit, no
component library, no chart library.

## Type definitions and linting

`@types/node` 20.19.43, `@types/react` 19.2.17, `@types/react-dom` 19.2.3,
`@types/d3-force` 3.0.10, `eslint` 9.39.5, `eslint-config-next` 16.2.12.

## Infrastructure

| Tool | What I used it for |
| --- | --- |
| Vercel | Hosting, Fluid Compute functions, and production deploys on git push |
| Vercel CLI 59.4.0 | Env management, deploy inspection, redeploys, reading function logs |
| Upstash Redis | Provisioned through the Vercel Marketplace. Map jobs at a seven-day TTL, grill sessions with no TTL, rate-limit counters, OAuth tokens keyed by session id |
| GitHub | Source hosting, and the deploy trigger |
| git 2.55.0 | Version control |

## External APIs

| API | What it gives me |
| --- | --- |
| GitHub REST, `api.github.com` | Repo metadata, size and visibility checks, the source tarball, and the user's repo list |
| GitHub OAuth, `/login/oauth/authorize` and `/login/oauth/access_token` | The consent redirect and token exchange that unlock private repos |

## Design

| Tool | Detail |
| --- | --- |
| `next/font` with Google Fonts | IBM Plex Sans and IBM Plex Mono for the app, Bricolage Grotesque reserved for the printed verdict |
| Next `ImageResponse` | Renders the share card as a PNG at request time |
| Design tokens in `src/app/globals.css` | The palette, hand-checked for contrast: panes separate at 1.2:1 and hairlines at 1.74:1 against the canvas |

## Testing, QA, and the demo

| Tool | Version | What I used it for |
| --- | --- | --- |
| agent-browser | 0.34.0 | Driving real browser passes against local and production builds: the deck, the express path, the streak rules, OAuth states, and screenshots for design review. Also recorded the demo video. |
| ffmpeg / ffprobe | 9.0.1 | Encoding the recording, extracting frames to verify the take, and laying the narration over the video |
| Apple Voice Memos | macOS | Recording the narration |

There is no automated test suite. Verification was done by exercising real flows against the
deployed site and reporting the actual output, which is why the numbers in the write-up are
measured rather than estimated.

## Vendored references

`upstash-redis-js` and `upstash-ratelimit-js` skills from `upstash/skills`, pinned in
`skills-lock.json`, used while wiring Redis and the rate limiters.
