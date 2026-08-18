import { NextResponse } from "next/server";
import { getJob, updateJob } from "@/lib/jobs";
import { generateLessons } from "@/lib/lessons/generate";
import { checkLimit } from "@/lib/ratelimit";

// One model call, made inline so the deck is there when the screen paints.
export const maxDuration = 120;

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

  // Generated lazily on first hit, then persisted with the map, so the map
  // still paints fast and a skipped deck costs no model call. Only the
  // generating hit is rate limited; re-reads of a built deck are free.
  let lessons = job.map.lessons;
  if (!lessons || lessons.length === 0) {
    const limited = await checkLimit(request, "lessons");
    if (limited) return limited;
    lessons = await generateLessons(job.map);
    await updateJob(id, job.stage, { lessons });
  }

  return NextResponse.json({
    lessons,
    repo: { owner: meta.owner, name: meta.name, defaultBranch: meta.defaultBranch },
  });
}
