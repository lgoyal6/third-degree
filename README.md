# Third Degree

**You built it. Now own it.**

Paste any public GitHub repo and get a map of what's actually in it — stack, structure, routes, data model, and where to start reading. Then (soon) get grilled on it until you can defend it in an interview.

Full product plan: [BUILD_PLAN.md](./BUILD_PLAN.md). Current milestone: **M0 — the Map**.

## Run it

```bash
npm install
cp .env.example .env.local   # optional: add ANTHROPIC_API_KEY for real summaries
npm run dev
```

Open http://localhost:3000, paste a repo (`owner/repo` or a full URL), and watch the map build.

## How M0 works

- `POST /api/map` validates the repo via the GitHub API (size-capped), then runs the pipeline fire-and-forget: shallow clone → file walk + language stats → framework detection → route/entry-point/category extraction → data-model extraction (Prisma/Drizzle/SQL/Mongoose) → a three-sentence Claude summary with a "start here" pick.
- The client polls `GET /api/map/[id]` and renders each section as its stage completes — something is on screen in seconds.
- Clones land in `.repos/` (gitignored); jobs live in memory with a 30-minute TTL. Both move to a real worker + store post-launch.

## Design

Tokens and rationale live in [design-system/third-degree/MASTER.md](./design-system/third-degree/MASTER.md) — interrogation-lamp amber on warm charcoal, Bricolage Grotesque / IBM Plex.
