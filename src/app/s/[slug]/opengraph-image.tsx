import { ImageResponse } from "next/og";
import { getSessionBySlug } from "@/lib/grill/store";
import { VERDICT_COPY } from "@/lib/grill/types";

export const alt = "Third Degree score card";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// This card IS the distribution (BUILD_PLAN §2) — it has to read perfectly in
// a timeline screenshot. Uses the bundled default font for now; swap in
// Bricolage via the `fonts` option before launch.
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSessionBySlug(slug);
  if (session?.repo.private) {
    return new Response("Not found", { status: 404 });
  }
  const score = session?.score ?? 0;
  const verdict = (session?.verdict ?? "raw").toUpperCase();
  const repo = session ? `${session.repo.owner}/${session.repo.name}` : "a repo";
  const copy = VERDICT_COPY[session?.verdict ?? "raw"];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#14100B",
          backgroundImage: "radial-gradient(ellipse 60% 45% at 50% -5%, rgba(255,178,36,0.25), rgba(20,16,11,0) 70%)",
          color: "#F3EDE3",
          fontSize: 28,
        }}
      >
        <div style={{ display: "flex", color: "#A79A85", fontSize: 24, letterSpacing: 4 }}>
          THIRD DEGREE
        </div>
        <div style={{ display: "flex", marginTop: 18, fontSize: 34 }}>{repo}</div>
        <div
          style={{
            display: "flex",
            marginTop: 6,
            fontSize: 200,
            fontWeight: 700,
            color: "#FFB224",
            lineHeight: 1,
          }}
        >
          {score}
        </div>
        <div style={{ display: "flex", fontSize: 44, fontWeight: 700, letterSpacing: 10 }}>
          {verdict}
        </div>
        <div style={{ display: "flex", marginTop: 10, color: "#A79A85" }}>{copy}</div>
        <div style={{ display: "flex", marginTop: 34, color: "#FFB224", fontSize: 24 }}>
          Get grilled on your own repo → third-degree.vercel.app
        </div>
      </div>
    ),
    { ...size },
  );
}
