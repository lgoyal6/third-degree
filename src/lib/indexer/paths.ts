import type { CategoryNode, CodeMap } from "../types";

function samples(nodes: CategoryNode[]): string[] {
  return nodes.flatMap((c) => [...c.sampleFiles, ...samples(c.children)]);
}

/**
 * Every path the map itself proves exists, most load-bearing first. Older maps
 * predate `CodeMap.filePaths`, so this is also the fallback file universe.
 */
export function mapPaths(map: CodeMap): string[] {
  return [
    ...new Set(
      [
        ...(map.entryPoints ?? []),
        ...(map.routes ?? []).map((r) => r.file),
        ...(map.models ?? []).map((m) => m.file),
        ...(map.graph?.nodes ?? []).map((n) => n.id),
        ...samples(map.categories ?? []),
      ].filter(Boolean),
    ),
  ];
}
