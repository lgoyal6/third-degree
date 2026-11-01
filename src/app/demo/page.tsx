import path from "node:path";
import Link from "next/link";
import DemoLesson from "@/components/DemoLesson";
import { walkRepo } from "@/lib/indexer/walk";
import { buildDepGraph } from "@/lib/indexer/graph";
import { extractRoutes } from "@/lib/indexer/structure";

export const dynamic = "force-static";

export default function DemoPage() {
  const root = process.cwd();
  const files = walkRepo(root).files.filter((file) => file.path.startsWith("src/"));
  const graph = buildDepGraph(root, files);
  const routes = extractRoutes(root, files, ["Next.js"]);
  return <main className="mx-auto w-full max-w-3xl px-6 py-14">
    <Link href="/" className="text-sm text-lamp underline">Third Degree</Link>
    <h1 className="mt-5 font-display text-4xl font-semibold">Explore the code, then defend a decision.</h1>
    <p className="mt-4 text-ink-muted">This sample maps Third Degree itself with the same file walker, route extractor and dependency graph used by the indexer. The map is computed from this build&apos;s source; it does not need a GitHub login, queue or model call.</p>
    <dl className="mt-7 grid grid-cols-3 gap-4 rounded border border-line p-5">
      {[[files.length, "source files"], [routes.length, "routes"], [graph.edges.length, "import links"]].map(([value, label]) =>
        <div key={label}><dt className="text-sm text-ink-muted">{label}</dt><dd className="text-2xl text-lamp">{value}</dd></div>)}
    </dl>
    <h2 className="mt-8 text-xl font-semibold">Trace a request</h2>
    <p className="mt-3 text-sm text-ink-muted">POST /api/map creates a shared job. The indexer reads the repository, extracts its structure and updates progress. GET /api/map/[id] returns that progress to the browser.</p>
    <details className="mt-5 rounded border border-line p-4"><summary className="cursor-pointer">Inspect computed source dependencies</summary>
      <ul className="mt-4 space-y-2 font-mono text-xs">{graph.edges.slice(0, 20).map((edge) => <li key={edge.s + ":" + edge.t}>{edge.s} → {edge.t}</li>)}</ul>
    </details>
    <DemoLesson />
  </main>;
}
