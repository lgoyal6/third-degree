# Narration script for `demo.mp4`

Video: `docs/submission/demo.mp4`, 1 minute 51 seconds, 1280x720, no audio.
Total read: 247 words, an average of 2.2 words a second, so every block has slack.

Record it in one continuous take and send me the MP3. I will lay it over the
video. If your read runs longer than a window, tell me and I will stretch that
hold in the picture rather than making you rush; the video is mostly static
holds, so there is room.

---

## Cue sheet

**0:00 - 0:18** · landing page, held still for you

> I'm Laksh, and this is Third Degree. It exists for one moment: an interviewer
> asks you to walk through code you shipped, and the room goes quiet. It takes a
> repo you built and interrogates you until you can defend it.

**0:18 - 0:31** · `vercel/ai-chatbot` typed in, Map it clicked, the map painting

> You paste any public repo. No signup. It walks every file and builds an import
> graph of the whole thing. A hundred and seventy six files, mapped in thirteen
> seconds.

**0:31 - 0:38** · the brief: what this app is, how it's organized

> First it orients you: what the app is, how it is organized, where to start
> reading.

**0:38 - 0:44** · the graph, then the hover lighting one file's imports

> Hover any file and its blast radius lights up. Fifty five things import this
> one.

**0:44 - 0:58** · lesson deck, card 1 then card 2

> Then it teaches the choices the repo actually made. App Router with route
> groups. Drizzle instead of Prisma, and what that costs you. Every card cites a
> real file.

**0:58 - 1:16** · question 1 of 10, the real snippet with line numbers, then a 95

> Now it grills you. Ten questions climbing from the language constructs your code
> leans on, to which file handles a request, to what breaks when you rename a
> field. Real code, real line numbers, no hints.

**1:16 - 1:37** · the express path: one open question, answered and graded

> Or you claim you already know it, and answer one question. The score comes off
> the import graph, with no model deciding anything. And every file you name that
> does not exist costs ten points. Someone who learned a codebase from an AI names
> the file where it usually lives.

**1:37 - 1:51** · 65 out of 100, MEDIUM stamped on paper, then the tape

> Sixty five. Read the last line: utils authHelper dot ts is not a real file. I
> planted one fake file in a strong answer and it caught it. That is Third Degree.

---

## Straight through, no cues

Read this as one take. The line breaks are breathing points, not pauses to time.

I'm Laksh, and this is Third Degree. It exists for one moment: an interviewer asks
you to walk through code you shipped, and the room goes quiet. It takes a repo you
built and interrogates you until you can defend it.

You paste any public repo. No signup. It walks every file and builds an import
graph of the whole thing. A hundred and seventy six files, mapped in thirteen
seconds.

First it orients you: what the app is, how it is organized, where to start reading.

Hover any file and its blast radius lights up. Fifty five things import this one.

Then it teaches the choices the repo actually made. App Router with route groups.
Drizzle instead of Prisma, and what that costs you. Every card cites a real file.

Now it grills you. Ten questions climbing from the language constructs your code
leans on, to which file handles a request, to what breaks when you rename a field.
Real code, real line numbers, no hints.

Or you claim you already know it, and answer one question. The score comes off the
import graph, with no model deciding anything. And every file you name that does
not exist costs ten points. Someone who learned a codebase from an AI names the
file where it usually lives.

Sixty five. Read the last line: utils authHelper dot ts is not a real file. I
planted one fake file in a strong answer and it caught it. That is Third Degree.

---

## Notes

- Say file paths as words: "utils authHelper dot ts", "lib slash db slash schema
  dot ts". Reading punctuation aloud sounds robotic.
- The two numbers are real and worth landing on: thirteen seconds to map a hundred
  and seventy six files, and fifty five imports on the file you hover.
- Every frame is production, and the map at 0:18 indexes live in the take.
- Timings are the beats measured during capture, not estimates. The scores on
  screen, 95 on the snippet question and 65 on the express run, are what the
  product actually returned.
