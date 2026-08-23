import { NextResponse } from "next/server";
import { getJob, updateJob } from "@/lib/jobs";
import { fetchRepo } from "@/lib/indexer/fetch";
import { walkRepo } from "@/lib/indexer/walk";
import { generateCraft } from "@/lib/craft/generate";
import { checkLimit } from "@/lib/ratelimit";
import { sessionToken } from "@/lib/auth/github";

// The upgrade list needs the files themselves, not just the map, so this can
// cost a checkout on a cold instance.
export const maxDuration = 300;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) {
    return NextResponse.json({ error: "Map not found or expired." }, { status: 404 });
  }
  const meta = job.map.meta;
  if (job.stage !== "done" || !meta) {
    return NextResponse.json({ error: "Map isn't finished yet." }, { status: 409 });
  }

  // Built on first visit and kept with the map: re-reads cost nothing, and a
  // repo nobody asks about costs no model call.
  let craft = job.map.craft;
  if (!craft || craft.length === 0) {
    const limited = await checkLimit(request, "craft");
    if (limited) return limited;
    try {
      // Pinned to the commit the map was built from, so a diff never points at
      // a line that has since moved.
      const { root } = await fetchRepo(
        { owner: meta.owner, repo: meta.name },
        await sessionToken(),
        job.map.sha,
      );
      const { files } = walkRepo(root);
      craft = await generateCraft(root, job.map, files);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Couldn't read the repo." },
        { status: 502 },
      );
    }
    await updateJob(id, job.stage, { craft });
  }

  return NextResponse.json({
    craft,
    repo: { owner: meta.owner, name: meta.name, defaultBranch: meta.defaultBranch },
  });
}
