import { after } from "next/server";
import { NextResponse } from "next/server";
import { createJob } from "@/lib/jobs";
import { parseRepoUrl } from "@/lib/github";
import { runIndex } from "@/lib/indexer/run";
import { checkLimit } from "@/lib/ratelimit";

// Indexing continues in `after()` once the response is sent, so the route needs
// headroom well past the sub-second reply.
export const maxDuration = 300;

export async function POST(request: Request) {
  const limited = await checkLimit(request, "map");
  if (limited) return limited;

  let body: { url?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const url = body.url?.trim();
  if (!url || !parseRepoUrl(url)) {
    return NextResponse.json(
      { error: "Paste a GitHub repo — owner/repo or a full URL." },
      { status: 400 },
    );
  }
  const job = await createJob(url);
  after(() => runIndex(job.id, url));
  return NextResponse.json({ id: job.id });
}
