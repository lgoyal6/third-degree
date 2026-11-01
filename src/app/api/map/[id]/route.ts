import { NextResponse } from "next/server";
import { getJob } from "@/lib/jobs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let job;
  try {
    job = await getJob(id);
  } catch (error) {
    console.error("Repository map could not be loaded", error);
    return NextResponse.json({ error: "Repository maps are temporarily unavailable. Please try again later." }, { status: 503 });
  }
  if (!job) {
    return NextResponse.json({ error: "Map not found or expired." }, { status: 404 });
  }
  return NextResponse.json(job);
}
