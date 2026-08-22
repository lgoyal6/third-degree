# Third Degree: Pathfinders submission

**You built it. Now own it.** Live at [third-degree.vercel.app](https://third-degree.vercel.app).

A generation of developers is shipping repos faster than they can understand them. The
projects work, the commits are green, the portfolio looks real, and then an interviewer asks
"walk me through what happens when two requests hit this endpoint at the same time" and the
room goes quiet. Third Degree exists for that moment.

Paste any public GitHub repo. No signup. Thirteen seconds later your code is mapped: what the app is, how it is organized, an interactive graph of every file and
import, your routes, your data model. Connect GitHub for private repos.
Then cards teach the choices your repo made, Drizzle instead of Prisma and what it costs. Then you get grilled: ten typed questions climbing
from the constructs your code leans on, to which file handles a request, to what breaks when
you rename a field. You leave with a score, a doneness rating from raw to
well-done, and a share card.

Ground truth comes from the repo, never from the model.
"Which files break if you rename `User.email`" is generated *and* graded from static analysis,
so there is no answer key to hallucinate. The model phrases questions and writes prose; it
never decides what is true. With no API key, every call falls back to deterministic output and
the scores do not move.

The sharpest version is the express path. Claim you already know your repo and you get one
question: explain what this system does and how the pieces connect, name the actual files and
models. The score comes off the import graph, weighted by how many things import each file. Then the mechanic I care about most: every file you name that does not
exist costs ten points, and the feedback names it. Someone who absorbed a codebase from an AI names
the file where it conventionally lives, not where theirs is, so `services/authService.ts` is
a tell. A real explanation of Vercel's AI chatbot scored 83. A
fluent, generic one scored 14. One with three invented paths scored 0, and was told which
three.

Two surfaces, on purpose. The tool looks like the place the work happened: a flat editor,
mono for anything that came out of your repo. The verdict is printed on paper with the rating
stamped in red, because a shared score should look like a graded exam.

Live now: the map, the lesson deck, the express path, the ten-question grill, groundedness
grading, share cards, private repos over GitHub OAuth, a browser-local streak, and per-IP
rate limits.

Next, in order. The pseudocode-to-code bridge: write pseudocode and convert it line by line,
or generate it from code you shipped. Sandboxed problems scoped to your own project, not
two-sum but "add a security layer to this route". Then the identity layer that makes streaks
and a curriculum durable. Nothing does the first one well, and it aims straight at the thesis: owning syntax you did not write.
