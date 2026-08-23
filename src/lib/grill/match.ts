// Answer-to-path matching, shared by the set graders and the Layer 4
// groundedness scorer. Kept out of grade.ts so the express scorer can reuse it
// without the two modules importing each other.

export function fileMatched(answer: string, file: string, siblings: string[] = []): boolean {
  const a = answer.toLowerCase();
  const f = file.toLowerCase();
  if (a.includes(f)) return true;
  const parts = f.split("/");
  const base = parts[parts.length - 1];
  const baseNoExt = base.replace(/\.[^.]+$/, "");
  if (parts.length >= 2 && a.includes(`${parts[parts.length - 2]}/${base}`)) return true;
  // A basename shared with another file in the same answer proves nothing on
  // its own: "server.ts" cannot pick artifacts/code/server.ts out of its three
  // siblings, and crediting it for all of them inflates the score.
  if (siblings.some((o) => o.toLowerCase() !== f && o.toLowerCase().split("/").pop() === base)) {
    return false;
  }
  // Framework-convention basenames (route.ts, page.tsx…) repeat everywhere —
  // they only count when dir-qualified, which the checks above cover.
  if (["page", "route", "index", "layout", "middleware"].includes(baseNoExt)) return false;
  if (a.includes(base)) return true;
  if (baseNoExt.length >= 4 && a.includes(baseNoExt)) return true;
  return false;
}

export function extractFileTokens(answer: string): string[] {
  return (
    answer.match(/[\w@./-]*[\w-]+\.(tsx?|jsx?|mjs|cjs|prisma|sql|css)\b|[\w@.-]+\/[\w@./-]+/g) ?? []
  );
}
