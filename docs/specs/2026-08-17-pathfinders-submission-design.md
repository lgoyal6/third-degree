# Design: Pathfinders submission scope

Date: 2026-08-17
Deadline: Stellic Pathfinders submission, 2026-08-21

## Context

Third Degree currently ships map → grill → score → share, deployed and verified on
Vercel with Upstash Redis. This spec covers the features added for the Pathfinders
submission, plus the fixes the live site needs before anyone sees it.

Explicitly cut from the submission: the profile system (name, school, topic
selection). Anonymous-first entry is preserved, which keeps BUILD_PLAN §2's no-auth
first touch intact.

## Scope boundary

In the submission:

1. Lesson deck between map and grill
2. Express path ("I know this repo") with deterministic groundedness scoring
3. Day streak and points, browser-local
4. GitHub OAuth connect for private repos
5. Fixes: `ANTHROPIC_API_KEY` in production, share card URL, map job TTL

Deferred to BUILD_PLAN, listed in "Out of scope" below.

---

## 1. Lesson deck

Sits between map and grill. Skippable and resumable. Teaches the stack choices the
repo actually made before testing the owner on them.

### Data

New type in `src/lib/types.ts`, stored as `CodeMap.lessons`:

```ts
export interface LessonCard {
  using: string;       // "Drizzle ORM"
  insteadOf: string;   // "Prisma, or raw SQL"
  whyItFits: string;   // cites real counts and paths from the map
  whatItCosts: string;
  evidence: string[];  // real repo-relative paths, rendered as links
}
```

### Generation

`src/lib/lessons/generate.ts` consumes the same facts object `src/lib/indexer/summary.ts`
already assembles (frameworks, routes, models, categories, hub files) and makes one
structured-output call, capped at six cards, ordered by how much each choice defines
the app.

`evidence` must contain paths that exist in the walked file set. Any card whose
evidence paths cannot be resolved is dropped before the deck is returned, so the deck
never links to a file that is not there.

Ground truth stays with the repo: card counts, paths, and framework detection all come
from the map. The model supplies only the comparison and tradeoff prose, which is
general framework knowledge rather than a claim about the user's code. This preserves
BUILD_PLAN §5.

### Fallback

With no `ANTHROPIC_API_KEY`, or on any generation failure, a deterministic deck is
built from detected frameworks alone: `using` is the framework, `whyItFits` names where
it was detected, `insteadOf` and `whatItCosts` are omitted and the card renders in a
reduced form. The deck is never empty, satisfying §5 ("every repo must yield
something") and §7 ("never a blank page").

### Routes

| Route | Behavior |
| --- | --- |
| `GET /api/map/[id]/lessons` | Returns `job.map.lessons`, generating and persisting on first hit. Rate limited under a new `lessons` bucket. |
| `/map/[id]/lessons` | Deck screen |

Generation is lazy rather than part of the indexing pipeline, so the map still paints
fast and no model call happens for users who skip the deck.

### UI

One card per screen, per §7's "one thing per screen". Progress dots, `Next`, and
`Skip all`. Right arrow or Enter advances, Esc skips the deck. Deck position is stored
in `localStorage` under `td:lessons:<jobId>`. The final card carries the grill CTA.

The map's existing grill CTA is repointed at `/map/[id]/lessons`.

---

## 2. Express path

For someone who knows the repo and wants to prove it in one shot rather than climb the
ladder. This is BUILD_PLAN §4's Defend mode in miniature and §5's Tier 3 groundedness
scoring applied directly.

### Entry

A secondary action on the map screen and on the lesson deck: "I already know this repo."

### Prompt

One open question: "In your own words, explain what this system does and how the pieces
connect. Name the actual files and models."

### Scoring: deterministic, no model in the loop

Extraction reuses `extractFileTokens` and `fileMatched` from `src/lib/grill/grade.ts`.

| Component | Source | Weight |
| --- | --- | --- |
| `hubCoverage` | matched `graph.nodes[]`, weighted by node degree | 0.5 |
| `modelCoverage` | matched names from `map.models[]` | 0.3 |
| `routeCoverage` | matched paths from `map.routes[]` | 0.2 |
| `phantoms` | file-shaped tokens with no match in the walked file set | −10 each |

```
score = clamp(0, 100, round(100 * (0.5*hub + 0.3*model + 0.2*route)) - 10*phantoms)
```

Phantom references are the central mechanic. A developer who absorbed a codebase from
an AI names the file where it conventionally lives rather than where theirs lives.
Feedback surfaces these explicitly: "You referenced `services/authService.ts`. That
file does not exist in this repo."

When the repo exposes no routes, `routeCoverage` is dropped and its 0.2 is
redistributed proportionally across the remaining weights, giving `hub` 0.625 and
`model` 0.375, so route-less repos are not capped below 100. The same rule applies to
`modelCoverage` when a repo defines no data models.

The model writes feedback prose only and never contributes to the score. With no API
key, feedback falls back to a template built from the matched and missed sets, so the
whole feature works without credentials.

### Storage

Runs as a `GrillSession` with a single question, reusing the existing session store,
scoring, verdict, and share card. No new persistence.

Two existing types in `src/lib/grill/types.ts` must widen to accommodate it:
`QuestionKind` gains `"overview"`, and `GrillQuestion.layer` widens from `1 | 2 | 3`
to `1 | 2 | 3 | 4`, since this is BUILD_PLAN §3's Layer 4. `GroundTruth` gains an
optional `hubs?: string[]` so the deterministic scorer has the weighted node list
available at grade time rather than recomputing it.

---

## 3. Streak and points

Browser-local. A durable, identity-backed version is deferred to BUILD_PLAN; this is
the version that ships without an accounts system.

### Data

One `localStorage` record under `td:progress`:

```ts
interface Progress {
  lastActiveDate: string; // ISO date, no time
  current: number;        // consecutive days
  longest: number;
  points: number;
}
```

### Rules

On any completion event (lesson deck finished, grill finished, express run finished):

- `lastActiveDate` is today: streak unchanged
- `lastActiveDate` is yesterday: `current += 1`
- otherwise: `current = 1`

`longest = max(longest, current)`. Points award 10 for a finished lesson deck, and the
final score for a finished grill or express run.

### Known limitation

Scoped to one browser. It resets on a cache clear, does not follow the user across
devices, and is client-side so it can be edited. Accepted deliberately for the
submission; the durable version needs the identity layer that was cut.

### UI

Compact streak and points readout in the header on map, lessons, grill, and score
screens. No separate stats screen, per §7's warning about resembling a dashboard.

---

## 4. GitHub OAuth connect

Adds a second entry path beside pasting a URL, and unlocks private repos. This is the
carve-out BUILD_PLAN §2 already allows: "GitHub OAuth exists only for private repos and
saving progress."

OAuth App rather than GitHub App. A GitHub App would give fine-grained per-repo
permission but needs an install flow, per-install tokens, and webhook handling that
does not fit the deadline. GitHub App is recorded in BUILD_PLAN as the upgrade.

### Flow

| Route | Behavior |
| --- | --- |
| `GET /api/auth/github` | Stores a CSRF `state` in Redis with a short TTL, redirects to GitHub authorize |
| `GET /api/auth/github/callback` | Validates `state`, exchanges the code, stores the token in Redis under a generated session id, sets the cookie |
| `GET /api/repos` | Lists the user's repos using the stored token |

Cookie holds only the session id and is `httpOnly`, `secure`, `sameSite=lax`. The
access token lives in Redis under `gh:<sessionId>` with a 7 day TTL and is never sent
to the client. `fetchRepo` uses the token when a session is present, which is what
makes private repos work.

### Scope tradeoff

OAuth App scopes are coarse. Reading private repos requires the `repo` scope, which
grants read and write across all of the user's repositories. Mitigations: the flow is
only triggered by an explicit "Connect GitHub" action, the consent screen is preceded
by a line explaining why the scope is needed, and pasting a URL remains the default
path so connecting is never required.

---

## 5. Fixes

| Fix | Detail |
| --- | --- |
| `ANTHROPIC_API_KEY` | Not set in production. The live map currently renders "Generated without an LLM - set ANTHROPIC_API_KEY for a real summary" to every visitor, and the grill generates zero Layer 1 questions, so it cold-opens with a structural question against §4. |
| Share card URL | `src/app/s/[slug]/opengraph-image.tsx` hardcodes `thirddegree.dev`, which does not serve the site. Point it at the live domain. |
| Map job TTL | `JOB_TTL_SECONDS` in `src/lib/jobs.ts` is 30 minutes, so a skipped lesson deck 404s on return. Raise to 7 days. |

---

## Error handling

| Case | Behavior |
| --- | --- |
| No API key, or lesson generation fails | Deterministic fallback deck |
| No API key, or feedback generation fails on express path | Template feedback; score is unaffected because it is deterministic |
| Expired map job | Explicit "this map expired" message with a re-map CTA, not a bare 404 |
| OAuth denied or state mismatch | Return to start with a message; the paste-a-URL path still works |
| Private repo requested with no session | Existing "Repo not found, is it public?" error |
| Rate limit exceeded | Existing 429 with `Retry-After` |

---

## Verification

This repo has no test harness. Verification is by exercising real flows against the
deployed URL and reporting actual output, as was done for the Vercel port.

1. Lesson deck against three repos: a Next/Drizzle repo, a Python/Flask repo, and a
   deliberately thin repo. Confirm every `evidence` path resolves, and confirm ordering
   puts the defining choice first.
2. Lesson fallback with `ANTHROPIC_API_KEY` unset. Confirm the deck renders and is not
   empty.
3. Express path: a strong answer, a vague answer, and an answer containing a
   deliberately invented file path. Confirm the phantom is caught and named.
4. Express path on a route-less repo, confirming the weight redistribution.
5. Streak: complete a run, confirm increment; simulate a same-day repeat and a
   two-day gap.
6. OAuth round trip on the deployed URL, including a private repo fetch.
7. Map job survives past 30 minutes.
8. Regression: map → lessons → grill → score → share still works end to end.

---

## Out of scope, deferred to BUILD_PLAN

- Profile system: name, school, topic selection
- Durable identity-backed streak, points, and leaderboards
- CV upload and project extraction
- GitHub App for genuine persistent connection with per-repo permissions
- Sandboxed code-writing problems ("write an API endpoint", "write a security layer")
- Pseudocode-to-code line-by-line bridge. Highest-value item of this set: nothing in
  the market does it well and it is directly on-thesis for owning syntax you did not
  write.
- System design with a drag-and-drop flowchart canvas
- Video lesson content
- Full curriculum with ordering and mastery per concept tag

## Order of work

1. Fixes: API key, card URL, TTL. Trivial, and they unblock honest demoing.
2. Lesson deck. The differentiator, and what the demo video shows.
3. Express path. Small, given the graph already exists, and it is the strongest
   anti-larp mechanic.
4. Streak and points. Self-contained and client-side.
5. GitHub OAuth. The cut line: if anything slips, this is what goes, because pasting a
   URL already demonstrates the identical flow.
6. Submission assets: 500-word write-up, two-minute video, tools list.
