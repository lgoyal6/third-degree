import { NextResponse } from "next/server";
import { getJob } from "@/lib/jobs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) {
    return NextResponse.json({ error: "Map not found or expired." }, { status: 404 });
  }
  return NextResponse.json(job);
}
