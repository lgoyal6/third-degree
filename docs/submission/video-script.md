# Demo narration, keyed to `demo.mp4` (1:48, 1280x720)

Read at a normal pace. Each block is sized to its window at roughly 2.5 words a
second, so there is slack rather than a rush. What is on screen is listed first,
then the line to say.

---

**0:00 - 0:18 | the landing page, held still for you**

*On screen: Third Degree, "You built it. Now own it.", one input.*

> Your intro goes here. Who you are, and the one sentence version of the problem:
> you shipped a repo with heavy AI help, and you cannot explain it yet.

If you want a written version to read:

> Hi, I'm Laksh. I built Third Degree for the moment before an interview when you
> realize you cannot explain code you shipped. It takes a repo you built, teaches
> you the choices it made, then interrogates you on it and scores how grounded
> your answers actually are.

**0:18 - 0:33 | typing a repo, then indexing**

*On screen: `vercel/ai-chatbot` typed in, Map it clicked, the map painting section by section.*

> Paste any public repo. No signup, no OAuth unless you want private repos. It
> pulls the tarball, walks every file, and builds an import graph. Thirteen
> seconds for a hundred and seventy six files.

**0:33 - 0:40 | the brief**

*On screen: what this app is, how it's organized, start-here file.*

> First it orients you. What the app is, how it is organized, and the one file to
> re-read first. Every claim in there comes from the repo, not from a guess.

**0:40 - 0:45 | the wiring**

*On screen: the graph, then hover on `lib/utils.ts`, 55 edges light up, everything else dims.*

> This is every file and every import. Hover one and you see its blast radius.
> Fifty five things import this file, so changing its exports touches all of them.

**0:45 - 0:58 | the lesson deck**

*On screen: card 1 App Router with route groups, then card 2.*

> Then it teaches the choices the repo made. App Router with route groups.
> Drizzle instead of Prisma, and what that costs you. Every card links to the real
> file, and any card that cannot cite a real path is dropped before you see it.

**0:58 - 1:15 | the grill**

*On screen: question 1 of 10, the `lib/ai/models.ts` snippet with real line numbers, an answer typed, then graded.*

> Now it grills you. Ten questions climbing from the language constructs your code
> leans on, to which file handles a request, to what breaks when you rename a
> schema field. Real snippet, real line numbers, clock running, no hints.

**1:15 - 1:37 | the express path, the part that matters**

*On screen: "I already know this repo", one open question, a strong answer typed, graded.*

> Or claim you already know it. One question, and the score comes straight off the
> import graph with no model deciding anything. Here is the mechanic I care about
> most. Every file you name that does not exist costs you ten points. Someone who
> absorbed a codebase from an AI reaches for the file where it usually lives, not
> where theirs is.

**1:37 - 1:48 | the verdict**

*On screen: 65 out of 100, MEDIUM stamped in red on paper, then the tape with the feedback.*

> Sixty five. And look at the last line: `utils/authHelper.ts` isn't a thing. I
> planted one fake file in a good answer and it caught it by name. That is the
> whole product. Third Degree, at third-degree.vercel.app.

---

## Notes for the take

- The video has no audio. Record narration over it, or read live while it plays.
- It was captured at 10 frames a second and re-encoded to 30, so scrolls are
  intentional jumps rather than pans. Nothing is dropped.
- Everything shown is production. The map at 0:18 indexes live in the recording.
- The two answers typed on camera are in `video-shot-list.md` if you want to
  re-shoot any beat by hand.
- Timings above are the real beats measured during capture, not estimates.
