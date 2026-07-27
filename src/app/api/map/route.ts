import { NextResponse } from "next/server";
import { createJob } from "@/lib/jobs";
import { parseRepoUrl } from "@/lib/github";
import { runIndex } from "@/lib/indexer/run";

export async function POST(request: Request) {
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
  const job = createJob(url);
  void runIndex(job.id, url);
  return NextResponse.json({ id: job.id });
}
