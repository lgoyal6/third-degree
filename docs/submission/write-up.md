# Third Degree: Pathfinders submission

**You built it. Now own it.** Live at [third-degree.vercel.app](https://third-degree.vercel.app).

I built Third Degree for one moment. You shipped a project, mostly with AI help, and it works. Then an interviewer asks what happens when two requests hit your endpoint at once, and you go quiet.

You paste a GitHub repo. No signup. Thirteen seconds later I show you
your own code: what the app does, how it is organized, a graph of every file and import,
your routes, your data model. If the repo is private, you connect GitHub first. Then I teach
you the choices your repo made, like Drizzle instead of Prisma and what they cost. Then I grill
you: ten questions that climb from the language features your code leans on, to which file
handles a request, to what breaks when you rename a field. You finish with a score, a
rating from raw to well-done, and a card to share.

What matters most is where the answers come from. I never let the model decide what is
true about your code. When I ask which files break if you rename `User.email`, I build the question from the
repo and grade it the same way, so there is no answer key to invent. The model writes
the wording, nothing else. Take the API key away and it still scores.

The express path is the sharpest version of that. You tell me you already know your repo, so
I ask one question: explain what this system does and how the pieces connect, and name the real files. I score it off the import graph, weighted by how many things import each file. Then the part I am proudest of. Every file you name that does not exist costs you
ten points, and I tell you which one. If you learned a codebase from an AI, you name the
file where it usually lives, not where yours is, so `services/authService.ts` gives you
away. I tried three answers on Vercel's AI chatbot. A real one scored 83. A fluent, vague one scored
14. One with three made-up paths scored 0, and I named all three.

I made the tool and the result look different. The tool looks like an editor,
because that is where you wrote the code. The verdict is printed on paper with the rating
stamped in red, because a score you send someone should feel like a graded exam.

Live today: the map, the lesson deck, the express path, the grill, private repos through GitHub OAuth, a daily streak, and rate limits.

Next I want to build the pseudocode bridge. You write pseudocode and I turn it into real code
line by line, or point at code you shipped and I turn it back.
After that, real problems inside your own project, like "add a security layer to this route"
instead of two-sum. Nobody does the first one well, and it is the whole point: owning syntax you did not write.
