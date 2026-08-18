import { NextResponse } from "next/server";
import { getSession } from "@/lib/grill/store";
import { publicView } from "@/lib/grill/view";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Grilling not found." }, { status: 404 });
  }
  return NextResponse.json(publicView(session));
}
