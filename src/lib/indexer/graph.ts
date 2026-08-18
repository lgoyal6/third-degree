import type { FileEntry } from "./walk";
import type { DepEdge, DepNode } from "../types";
import { buildImportGraph } from "../imports";
import { bucketFor } from "./structure";

const MAX_NODES = 120;
const MAX_EDGES = 500;

// Layer 0 wiring diagram: files as nodes, imports as edges. Capped so the
// visualization stays readable — the cut keeps the most-connected files.
export function buildDepGraph(
  root: string,
  files: FileEntry[],
): { nodes: DepNode[]; edges: DepEdge[] } {
  const graph = buildImportGraph(root, files);
  const byPath = new Map(files.map((f) => [f.path, f]));

  const ids = new Set<string>([...graph.imports.keys(), ...graph.importedBy.keys()]);
  let nodes: DepNode[] = [...ids].map((id) => {
    const f = byPath.get(id);
    const deg = (graph.imports.get(id)?.size ?? 0) + (graph.importedBy.get(id)?.size ?? 0);
    return {
      id,
      cat: (f && bucketFor(f)?.cat) ?? "Backend",
      loc: f?.loc ?? 0,
      deg,
    };
  });

  nodes.sort((a, b) => b.deg - a.deg);
  if (nodes.length > MAX_NODES) nodes = nodes.slice(0, MAX_NODES);
  const kept = new Set(nodes.map((n) => n.id));

  const edges: DepEdge[] = [];
  for (const [from, targets] of graph.imports) {
    if (!kept.has(from)) continue;
    for (const to of targets) {
      if (!kept.has(to)) continue;
      edges.push({ s: from, t: to });
      if (edges.length >= MAX_EDGES) return { nodes, edges };
    }
  }
  return { nodes, edges };
}
