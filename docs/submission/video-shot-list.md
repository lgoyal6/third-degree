# Two-minute video: shot list

Everything below is pre-warmed on production, so nothing indexes, generates, or waits on
camera. Open these in tabs before you hit record.

| Tab | URL |
| --- | --- |
| Map (Vercel AI chatbot, 176 files) | https://third-degree.vercel.app/map/f3daa22e-54ba-4abb-96d8-88a020ab4dee |
| Lesson deck for it | https://third-degree.vercel.app/map/f3daa22e-54ba-4abb-96d8-88a020ab4dee/lessons |
| Grill, already at question 1 of 10 | https://third-degree.vercel.app/grill/b3fb81ad-810f-43b0-bfd8-2192064c95ea |
| Map of this repo, for the closing beat | https://third-degree.vercel.app/map/5ba6f6e3-7fe6-4f66-9525-9f9807053e27 |

## Before you record

- Clear `localStorage` on the site if you want the streak badge to appear mid-video, or
  complete one deck first if you want it visible from the start.
- Turn off the Next.js dev tools badge by recording against production, not `localhost`.
- Put the three answers below on your clipboard manager. Typing them live burns 40 seconds.
- The express question's feedback takes a few seconds to come back. Either let it sit or cut.
- Zoom the browser to about 110% so the mono type reads on a phone.

## The shots

**0:00 - 0:12 — the hook.** No screen yet, or a static title card.
> "Everyone is shipping code faster than they can explain it. Then an interviewer asks what
> happens when two requests hit this endpoint at once, and the room goes quiet."

**0:12 - 0:22 — paste a repo.** Home screen, type `vercel/ai-chatbot`, hit go. Cut to the
warmed map tab as it finishes painting.
> "Paste any public repo. No signup."

**0:22 - 0:40 — the map.** Scroll: summary, then the dependency graph. Hover one big node so
the blast radius highlights. Keep scrolling past routes and the data model.
> "Ten seconds later: what the app is, every file and every import, the routes, the models.
> 176 files I did not write."

**0:40 - 0:58 — the lesson deck.** Card 1 (App Router with route groups), press the right
arrow to card 2 (Drizzle instead of Prisma). Point the cursor at the evidence links.
> "First it teaches the choices the repo made. Drizzle instead of Prisma, and what that costs
> you. Every card links to the real file, because the card was built from the repo, not from a
> guess."

**0:58 - 1:20 — the grill.** Switch to the warmed grill tab, question 1 of 10 with the
`lib/ai/models.ts` snippet on the left. Paste answer A. Show the score and the feedback line.
> "Then it grills you. Ten questions climbing from the language constructs your code uses, to
> which file handles a request, to what breaks when you rename a schema field. Typed answers.
> Clock running."

**1:20 - 1:45 — the express path, the money shot.** Back to the map tab, click "I already know
this repo". Paste answer B, which is strong but names one file that does not exist. Let the
feedback land and hold on the callout.
> "Or claim you already know it. One question, scored straight off the import graph. And every
> file you name that does not exist costs you ten points. That is the tell: someone who
> absorbed a codebase from an AI names the file where it usually lives, not where theirs is."

**1:45 - 2:00 — verdict, card, close.** Show the score and doneness rating, click Copy share
link, then flash the map of this repo.
> "You get a score, a verdict you can share, and a streak if you come back. I built it on
> itself. Third Degree, at third-degree.vercel.app."

## Answers to paste

**A — grill question 1** (`Promise.all` over `chatModels.map`):

```
It fires one capabilities fetch per chat model concurrently and resolves only when all of
them settle, so total latency is the slowest single request rather than the sum. Swapping in
a sequential for-await loop would make it the sum of every request, and one slow gateway
response would stall every model behind it. Promise.all also rejects on the first failure,
which is why each fetch has its own try/catch inside the map.
```

**B — express answer, strong with one planted phantom:**

```
It is a Next.js chatbot. lib/db/schema.ts and lib/db/queries.ts carry the data layer,
app/(auth)/auth.ts owns sessions including the guest path, and chat traffic enters
app/(chat)/api/chat/route.ts before streaming back through the stream route. The artifact
panel is components/chat/artifact.tsx, and lib/ai/providers.ts picks the model. Auth helpers
live in utils/authHelper.ts. Models: Chat, Message_v2, Vote_v2, Document, Suggestion, Stream,
User.
```

`utils/authHelper.ts` is the planted one. Expect the score to drop by ten and the feedback to
name that file as nonexistent.
