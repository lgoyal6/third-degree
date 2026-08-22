import { ImageResponse } from "next/og";
import { getSessionBySlug } from "@/lib/grill/store";
import { VERDICT_COPY } from "@/lib/grill/types";

export const alt = "Third Degree score card";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// This card IS the distribution (BUILD_PLAN §2), so it has to read perfectly in
// a timeline screenshot. Printed on paper rather than in the app's own dark
// palette: a shared verdict should look like a graded exam, not like a
// screenshot of a website. Uses the bundled default font for now; swap in
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
          justifyContent: "space-between",
          backgroundColor: "#F4F0E6",
          color: "#16181B",
          padding: "56px 64px",
          fontSize: 28,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: "2px solid #C4BCA9",
            paddingBottom: 20,
            color: "#5C5849",
            fontSize: 24,
          }}
        >
          <div style={{ display: "flex", letterSpacing: 6 }}>THIRD DEGREE</div>
          <div style={{ display: "flex" }}>{repo}</div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <div style={{ display: "flex", fontSize: 210, fontWeight: 700, lineHeight: 1 }}>{score}</div>
              <div style={{ display: "flex", fontSize: 48, color: "#5C5849", paddingBottom: 24 }}>/100</div>
            </div>
            <div style={{ display: "flex", marginTop: 14, color: "#5C5849", fontSize: 30 }}>{copy}</div>
          </div>
          <div
            style={{
              display: "flex",
              transform: "rotate(-4deg)",
              border: "4px solid #B3352F",
              borderRadius: 8,
              color: "#B3352F",
              fontSize: 46,
              fontWeight: 700,
              letterSpacing: 6,
              padding: "10px 22px",
            }}
          >
            {verdict}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            borderTop: "2px solid #C4BCA9",
            paddingTop: 20,
            color: "#5C5849",
            fontSize: 24,
          }}
        >
          <div style={{ display: "flex" }}>Get grilled on a repo you built</div>
          <div style={{ display: "flex", color: "#16181B" }}>third-degree.vercel.app</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
