# Third Degree: Pathfinders submission

**You built it. Now own it.** Live at [third-degree.vercel.app](https://third-degree.vercel.app).

A generation of developers is shipping repos faster than they can understand them. The
projects work, the commits are green, the portfolio looks real, and then an interviewer asks
"walk me through what happens when two requests hit this endpoint at the same time" and the
room goes quiet. Third Degree exists for that moment.

Paste any public GitHub repo. No signup. In about ten seconds you see your own code mapped:
what the app is, how it is organized, an interactive graph of every file and import, your
routes with real HTTP methods, your data model. Then cards teach the stack choices your
repo actually made, Drizzle instead of Prisma and what that costs you, each card linking
to the real files. Then you sit down and get grilled: ten typed questions climbing from the
language constructs your code leans on, to which file handles a request, to what breaks when
you rename a schema field. You leave with a score out of 100, a doneness rating from raw to
well-done, and a share card.

The idea that makes it work is that ground truth comes from the repo, never from the model.
"Which files break if you rename `User.email`" is generated *and* graded from static analysis,
so there is no answer key to hallucinate. The model phrases questions and writes prose; it
never decides what is true. With no API key, every one of those calls falls back to
deterministic output and the scores do not move.

The sharpest version is the express path. Claim you already know your repo and you get one
question: explain what this system does and how the pieces connect, name the actual files and
models. The score comes off the import graph, weighting your load-bearing files by how many
things import them. Then the mechanic I care about most. Every file you name that does not
exist costs ten points, and the feedback names it. Someone who absorbed a codebase from an AI
reaches for the file where it conventionally lives rather than where theirs lives, so
`services/authService.ts` is a tell. A real explanation of Vercel's AI chatbot scored 83. A
fluent, generic one scored 14. One with three invented paths scored 0 and was told exactly
which three files were imaginary.

Shipped and live: the map, the lesson deck, the express path, the ten-question grill,
groundedness grading, public verdict pages with generated OG cards, a browser-local streak,
and per-IP rate limits.

Next, in order. The pseudocode-to-code bridge: write pseudocode and convert
it line by line, or generate pseudocode from code you already shipped. Sandboxed problems
scoped to your own project, not two-sum but "add a security layer to this route". Then the
identity layer that makes streaks and a real curriculum durable. Nothing in the market does
the first one well, and it targets the thesis exactly: owning syntax you did not write.
