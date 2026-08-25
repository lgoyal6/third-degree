# Build Plan - working title "Anti-larp"

> Milestones are ordered; work them in order.
> **M0 + M1 is the launch.** Everything after ships to real users, not toward a someday-launch.

---

## 0. Goal

Users and community. Monetization is explicitly not a goal for v1 - no pricing page, no paywall thinking, no "premium tier" design debt. Success looks like: strangers posting their scores without being asked.

Hard deadline: **live by the first week of September 2026.** Fall internship/new-grad recruiting ramps through August–September; that is when "interview Thursday" panic peaks. Shipping in November misses the season.

---

## 1. What this is

A platform that takes a repo you built (probably with heavy AI assistance) and grills you on it - then teaches you your own stack through it, ending with you able to defend the thing in an interview.

**The user:** has 10–30 repos. Shipped them fast. They work. They can't confidently explain the middleware, don't know why the ORM call is structured that way, and have an interview where someone will ask.

**The promise:** "You built it. Now own it."

**The wedge:** interview panic, not a desire to learn. Nobody wakes up wanting to study their own middleware; they arrive because an interview is Thursday, the app broke, or a real engineer embarrassed them. Every acquisition surface speaks to the panic; the learning is what they discover once inside.

**Not:** a code review tool, a documentation generator, or a chatbot over your repo. Those exist. Chat-over-repo tools explain code *to* you; mock-interview tools grill you from your *resume text*. Nothing grills you from your actual code with code-derived ground truth. That's the open spot.

---

## 2. Distribution is a feature, not an afterthought

This section outranks everything below it, because the stated goal is users.

**The share card is the growth loop.** "I scored 41% on a repo I 'built'" is ego-bait that screenshots itself onto X and r/csMajors. The card shows: score, repo name, language badges, one brutal sample question, and the URL. Auto-generated OG image so the link unfurls properly. This ships in M1 and gets real design time - it is the entire marketing plan.

**No-auth first touch.** Paste any public GitHub URL → get the map → get grilled → get a score. No signup, no OAuth, nothing. GitHub OAuth exists only for private repos and saving progress. Bonus loop: people can map and grill themselves on *other people's* repos - famous OSS projects, viral vibe-coded apps - which is shareable content in its own right.

**Launch sequence:**
1. Build-in-public thread on X from day one (the map screenshots alone are content).
2. M1 goes live → Show HN ("I built a tool that grills you on your own code"), r/csMajors, r/webdev, campus/club Discords.
3. Ride the recruiting calendar: "Can you defend your resume projects? Prove it" lands differently in September than in December.

---

## 3. The spine: five layers

Everything hangs off this ladder. A repo gets decomposed, then questions are generated at each rung, ascending. **Launch ships Layers 0–2 (plus static-analysis Layer 3 questions); Layers 4–5 come later.**

**Layer 0 - Map** (no questions, pure orientation)
Languages, frameworks, dependency list, entry points, routes, data model, "what this app does" in three sentences **plus a "how it's organized" walkthrough**. Split into **Frontend / Backend / Data / Infra**, then subdivided - under Backend: API routes, business logic, data access, auth, background jobs. Rendered as a guided tour that teaches before it tests: blurb first, then structure, then **an interactive dependency graph of every file and import** (the wiring diagram - hover to see blast radius visually), and only then the grill CTA. First-run magic moment; something must appear on screen in seconds (progressive render), the full map in under 90.

**Layer 1 - Atoms** (language & framework literacy)
Short questions on real snippets from their code. Not "what is async" - "here's your `getUser`, the `await` on line 12 is removed, what does the caller receive?" Language semantics, framework idioms and limits, and small algorithmic reasoning where their code actually contains it (the sort, the nested filter, the O(n²) lookup in the render loop).

**Layer 2 - Modules** (component-level)
Scoped to one category at a time. "Your API layer." Where does validation happen, where do errors get caught, what does this middleware do to the request object.

**Layer 3 - Seams** (integration)
Cross-module blast radius. "You rename this schema column - list every file that breaks." Auto-generated and auto-graded from the reference graph. This is where architecture begins and where most AI-built codebases are genuinely broken.

**Layer 4 - System** (design defense)
Scale pressure and tradeoffs applied to their real schema and real routes. "10k users, Postgres at 90% CPU, here's your feed query - go." Open-ended, graded on groundedness.

**Layer 5 - Craft** (the "I didn't know that existed" layer)
Concrete upgrades to what they built - UI techniques, accessibility, error and empty states, production hardening - each shipped as a *shown diff against their code*, not advice. The comeback layer.

---

## 4. Modes: Grill is the front door, Learn is the retention

| | **Grill** (M1) | **Learn** (M2) | **Defend** (late) |
|---|---|---|---|
| What it is | ~10 questions, a score, a share card | Full curriculum up the ladder | Timed, recorded, full session |
| Companion | Off | On, proactive | Off entirely |
| Hints | None | Layered, on request | None |
| Output | Score + share card | Progress, review cards | Shareable recording |

Grill is Defend-lite: it exists at launch because it's the acquisition loop. Learn is the product people stay for - every missed Grill question is an on-ramp ("you got this wrong - want to actually understand it?"). Full Defend mode (timed, recorded, shareable session) is the polished endgame, not the starting point. Help and assessment never coexist in one mode - the companion destroys any timing signal.

**Grill questions climb from the ground up** (decided Jul 27, 2026): fundamentals first (the language/DSA constructs their code actually uses - the array chain, the await, the loop complexity), then function behavior, then modules (routes, models), then seams (blast radius). Never cold-open with a structural question - the user meets easy ground they can stand on, then the floor rises.

---

## 5. Grading substrate

**Still the hardest part and the only defensible part - but the moat matters later; the magic matters now.** The rule stands: derive ground truth from the repo wherever possible, use the LLM to *phrase* questions, not to decide answers.

**Tier 1 - Semantic analysis (no LLM in the loop).**
v1 is TypeScript-only, so use the **TypeScript compiler API** (or ts-morph), *not* tree-sitter. Tree-sitter gives syntax trees without resolved references - it cannot answer "what breaks if this changes." The TS compiler gives real reference resolution, call graphs, and type-aware breakage out of the box, and is less work than building a symbol table on tree-sitter. Blast-radius questions are auto-generated and auto-graded from this graph. (Tree-sitter enters later, when we go multi-language.)

**Tier 2 - Git history mining (opportunistic only).**
Pick a real feature commit, hide the diff, describe the feature in prose, ask which files change - the diff is the answer key. Inverted for bug-fix commits. **The thin repo is the default case, not the edge case:** the target user's repos have six commits, one of which is "initial commit" with 4,000 lines. Git mining activates silently when history supports it and never carries the experience. Gate on commit count and diff quality.

**Tier 3 - Groundedness scoring (LLM, constrained).**
For open-ended answers, do not grade correctness. Extract the symbols the answer names, check them against the real symbol graph, and check whether they're the *relevant* ones. "Add caching" scores low. "Cache in `getUserFeed`, but `POST /follow` has to bust it and currently doesn't know the cache exists" scores high. **Generic-but-correct must lose to specific-and-partial.** That's the whole incentive design - do not compromise it.

Target mix: 70% Tier 1+2, 30% Tier 3.

**Every repo must yield something.** The readiness score, honestly computed, will tell most early users their repos are thin - frame it as "how interrogable is this repo," and guarantee even the thinnest repo produces a real map and a real grilling. The first impression must never be an insult.

---

## 6. The companion

A small persistent character, Learn mode only. Non-modal - never blocks the screen or steals focus. Persona suggestion: **a rubber duck.** Rubber-duck debugging, inverted - instead of you explaining your code to the duck, the duck asks you. Devs get the joke instantly.

**Trigger on struggle signals the product can actually observe** (this is a Q&A surface, not an editor - no edit-thrash or undo telemetry exists here):
- Two wrong attempts on one question
- Long dwell on a question with no input
- Answer started, deleted, restarted
- Explicit "I'm stuck"

**Escalation ladder** (never skip a rung; each requires the user to say something):
1. Ask what they think is happening. Reflect it back.
2. Narrow the region. Highlight where to look.
3. Name the concept, not the answer.
4. Show the answer, and mark the concept for review.

Saying where you think the problem is earns a *sharper hint at the same level*. Only a bare "show me more" descends a rung. Keeping the user talking is where the learning happens.

**Mistakes generate review cards.** Spaced repetition, resurfaced across sessions and across repos. A mistake in repo A about React state resurfaces in repo D.

---

## 7. UI: extremely user-friendly

The single biggest failure mode is looking like a dashboard. Nobody learns from a dashboard.

**Non-negotiables:**

- **One thing per screen.** One question, one map, one lesson. No sidebars full of options during a question.
- **Never a blank page.** Every empty state names the next action in one sentence with a button attached.
- **Code and question always co-visible.** Split view, code on the left with the relevant lines highlighted.
- **Progress must be physical.** A ladder or path showing the five layers with your position on it. Not a percentage.
- **Keyboard first.** Enter submits, `?` opens the companion, `Esc` closes everything, arrows navigate. Visible focus rings throughout.
- **Zero-config start.** Paste a URL → the map appears. No settings, no onboarding tour. The map *is* the tour.
- **Answers are typed, never multiple choice** above Layer 1. Multiple choice is a tell that you're not really being tested.
- **Responsive to mobile, `prefers-reduced-motion` respected.** The share card must look right *in* a phone screenshot.

**Screens (the entire v1 surface - resist adding more):**

1. **Start** - one input (paste a repo URL), one secondary button (connect GitHub for private repos).
2. **Map** - the Layer 0 breakdown, explorable, with "Start here" pointing at the recommended entry.
3. **Session** - split view, question left-of-code, one primary button. (Companion docks bottom-right in Learn mode.)
4. **Score** - the Grill result + share card. One screen, one share button.
5. **Repo shelf** (auth'd users) - cards showing language, size, commit depth, readiness score. Sorted by readiness.
6. **Review** (M2+) - what you got wrong, what's scheduled to come back.
7. **Craft** (M5) - the upgrade list, each item a before/after diff.

**Visual direction:** commit to one and be consistent. Avoid the current AI-design defaults (cream + serif display + terracotta; near-black + acid green; broadsheet hairline rules). Pick a display face and a body face that aren't the pairing every dev tool uses, set one signature element, keep everything else quiet.

---

## 8. Data model (sketch)

```
User          (nullable on early tables — anonymous sessions are first-class)
Repo          id, url, owner_user_id?, primary_language, frameworks[], readiness_score, last_indexed_sha
CodeMap       repo_id, sha, categories[], entry_points[], routes[], schema_summary, three_sentence_summary
SymbolGraph   repo_id, sha, symbols[{name, kind, file, line, referenced_by[], calls[]}]   — from TS compiler, cached per SHA
Question      repo_id, layer, prompt, ground_truth, grading_tier, concept_tags[]
GrillSession  user_id?, repo_id, question_ids[], score, share_slug
Attempt       session_id, question_id, answer, score, latency_ms, hints_used
ReviewCard    user_id, concept_tag, due_at, ease            — M4
CraftItem     repo_id, category, before, after, rationale   — M5
```

**Concepts are emergent in v1, not canonical.** No hand-curated ontology with prerequisites - that's weeks of taxonomy work v1 doesn't need. The LLM tags questions with free-form slugs (`stale-closure`, `n-plus-one`); dedupe and formalize later, when real data shows which concepts recur. Cross-repo resurfacing works fine on fuzzy tags.

---

## 9. Stack & infra

- Next.js + TypeScript, Postgres (Supabase is fine)
- **TypeScript compiler API / ts-morph** for the symbol and reference graph - not tree-sitter (v1 is TS-only; tree-sitter returns when other languages do), and never an LLM for structure extraction
- **Indexing runs in a worker, not in request handlers.** `git clone --filter=blob:none` + parse happens on a small job runner (Fly/Railway box, or queue-fed background functions) - never inside a serverless request
- Anthropic API for question phrasing, explanation, groundedness scoring, and craft suggestions
- Cache aggressively per commit SHA; re-index only changed files
- **Abuse controls from day one** (free product, LLM calls, arbitrary clones): repo size cap, blob-less shallow clones, N free maps per IP before requiring GitHub login, rate limits on grading calls

---

## 10. Milestones

**M0 - Map.** *Target: Aug 16, 2026.*
Paste a public URL (no auth), clone, parse with the TS compiler, produce the Layer 0 breakdown, render it progressively - something in seconds, everything in under 90. GitHub OAuth for private repos. This alone is demoable and should feel like magic. Do not move on until it's fast.

**M1 - Grill + share card. This is launch.** *Target: live by Sept 4, 2026.*
~10 questions per session from Layers 1–3 (snippets + blast radius from the graph), typed answers, a score, and a share card with a proper OG image. Show HN + X + Reddit the week it's stable. The bar: beta users share their score *without being asked*. If the questions are boring, nothing else matters - fix that before launching, not after.

**M2 - Learn mode.** *Through September.*
Every missed Grill question becomes an on-ramp. Hint ladder (simplified triggers, §6), mistake review, mastery per concept-tag. Prove people come back the next day.

**M3 - Grading substrate deepening.** *October.*
Full reference graph coverage, git-history mining where history supports it, groundedness scoring for open-ended answers. This is the moat; give it real time - but it earns that time only after launch traffic proves the wedge.

**M4 - Companion & spaced repetition.** *October–November.*
The duck, the full escalation ladder, review cards resurfacing across sessions and repos.

**M5 - System & Craft.** *November.*
Layer 4 scale-pressure questions, Layer 5 upgrade diffs.

**M6 - Full Defend + multi-repo.** *December - before spring interview season.*
Timed, unassisted, recorded, shareable session link. Portfolio view, cross-repo concept tracking, "I have an interview Thursday on these 4 repos" cram path.

---

## 10a. Deferred platform direction

*Captured Aug 17, 2026, scoping the Stellic Pathfinders submission. These are wanted but did not fit the Aug 21 deadline. Shipped in that submission: lesson deck, express describe-path, browser-local streak, GitHub OAuth. Full spec in `docs/specs/2026-08-17-pathfinders-submission-design.md`.*

**Identity layer.** ~~Profile with name, school, and topic selection, in the LeetCode/NeetCode mold.~~ **Shipped Aug 23, 2026.** GitHub sign-in, keyed by GitHub's numeric id, with `read:user` for signing in and the coarse `repo` scope kept as a separate grant for private repos. The two calls this section asked for, made deliberately: **no account gate anywhere** - paste a URL, map, grill and share all work anonymously, so §2's share loop is untouched and signing in only adds durability - and **no leaderboard**, per §11. Local state stays the working copy; the account is its durable mirror, merged on load with idempotent rules so anonymous history survives signing in. Profile is name (from GitHub), optional free-text school, and up to five focus concepts picked from the tags the user's own answers produced, which then join the due list when a session starts. Deleting an account deletes its state, user record and session.

**Durable streak, points, leaderboard** *(streak and points shipped Aug 23, 2026; leaderboard still ruled out by §11)*. The browser-local versions remain the anonymous path and still say so on screen.

**CV as an entry path.** Upload a resume, extract the listed projects, match them to repos. Strong acquisition fit, because interview panic presents as resume anxiety, so the CV is the artifact the panic is already attached to.

**GitHub App.** Replaces the submission's OAuth App. Gives genuine persistent installation and per-repo permissions, instead of OAuth's coarse `repo` scope that asks for read and write across every repository the user owns.

**Pseudocode-to-code bridge.** Highest-value item in this list. Write pseudocode and convert it line by line to real code, or generate pseudocode from code you already shipped. Nothing in the market does this well, and it targets the thesis precisely: owning syntax you did not write. Build this before anything else here.

**Sandboxed code-writing problems.** Not "two sum" but "write this API endpoint", "add a security layer to this route", scoped to their own project. This is the single largest engineering commitment in the list: it needs a sandbox plus a grading harness per problem. Watch §5 carefully, because the cheap path is LLM-graded output, which is exactly what §5 forbids.

**System design canvas.** Layer 4 and 5 as drag-and-drop flowcharts and architecture diagrams, not just prose. The express describe-path shipped for Pathfinders is the text-only precursor; §5's groundedness scoring extends to a diagram by checking named nodes against the real graph.

**Video lesson content.** Wanted, and the cost outlier by an order of magnitude. Flashcards captured most of the value for a fraction of the effort, which is why the submission ships cards. Revisit only if card completion data says people want more depth.

**Full curriculum** *(shipped Aug 23, 2026)*. Ordered modules, prerequisites, mastery per concept tag, and "rebuild your own project" as the capstone - all derived, none authored, because §8 rules out a hand-curated ontology and says to formalize once the data shows which concepts recur. Mastery is computed per tag from their own answers, with an explicit confidence flag so a single lucky answer never reads as mastery. Order comes from the §3 layer each concept was tested at, which cards now record; prerequisites fall out of that as "easier after X" rather than as gates (§7). Modules are the model naming groups from a list of the user's own tags, which it may not add to; with no model available the layer grouping is the whole answer. The capstone is built from their map: models to write from memory, the entry point, two endpoints and a page, the file everything leans on, then breaking it on purpose.

---

## 11. Explicitly out of scope for v1

- Any language outside the TS/JS ecosystem
- Employer-side accounts or a hiring marketplace
- Leaderboards or public rankings (share cards yes, rankings no)
- Voice input
- Auto-applying craft fixes as PRs (show the diff; let them apply it)
- Anything resembling a certificate
- A curated concept ontology (emergent tags only, see §8)
- Monetization of any kind

---

## 12. Known risks - revisit at each milestone

1. **Boring questions kill the loop.** The share card only spreads if the grilling stings. This is the #1 risk at M1 - measure voluntary share rate from the first beta user.
2. **Motivation, not competition, is the threat.** You're selling back the understanding the user bought their way out of. Attach to the painful moment (interview Thursday, it broke, a real engineer criticized it); never market "learning."
3. **Thin repos are the default case.** Six-commit 3k-line CRUD apps must get a great experience from static analysis alone. If the demo only shines on well-factored repos with rich history, it fails the actual audience.
4. **The map is the whole first impression.** If it's slow or generic, nothing downstream matters.
5. **Episodic use vs. community.** Interview prep churns by nature - someone crams Thursday, leaves Friday. Acceptable *if* the share loop replaces them; share rate is the metric that matters, not retention, until M2 gives people a reason to stay.
6. **Cost and abuse.** Free + LLM + clones from strangers. Controls in §9 ship with M0, not after the first incident.
7. **Question repetition across similar repos.** Two users with similar Next.js apps getting near-identical questions collapses the personalization claim. Real risk, but deprioritized - users can't compare until there's a community. Revisit at M6.

---

## 13. Name

**Decided Jul 27, 2026: Third Degree** - the interrogation idiom plus the burn pun; threatens the code, not the person. `thirddegree.dev` was available at decision time (register it). "Anti-larp" stays as the campaign hashtag/launch framing. Runners-up checked the same day: `antilarp.dev` and `repogrill.com` available, `getviva.dev` available; `viva.dev`, `stackproof.dev`, `ownit.dev`, `grillme.dev` taken.
