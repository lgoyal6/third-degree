"use client";

import { useMemo, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from "d3-force";
import type { DepEdge, DepNode } from "@/lib/types";

// Categorical palette validated with the dataviz six-check script against the
// #14100B surface (worst adjacent CVD ΔE 9.7; all ≥3:1 contrast). The bright
// UI amber (#FFB224) is reserved for accent/hover, not data marks.
const CAT_COLOR: Record<DepNode["cat"], string> = {
  Frontend: "#3D8BE0",
  Backend: "#C27A00",
  Data: "#18A170",
  Infra: "#A671E3",
};

const W = 860;
const H = 540;

interface SimNode extends SimulationNodeDatum {
  id: string;
  cat: DepNode["cat"];
  loc: number;
  deg: number;
}

interface Layout {
  nodes: (SimNode & { x: number; y: number; r: number })[];
  links: { s: string; t: string; x1: number; y1: number; x2: number; y2: number }[];
  labeled: Set<string>;
}

function computeLayout(nodes: DepNode[], edges: DepEdge[]): Layout {
  const simNodes: SimNode[] = nodes.map((n) => ({ ...n }));
  const simLinks = edges.map((e) => ({ source: e.s, target: e.t }));

  // Static layout: tick synchronously, render once. No animation to disable.
  const sim = forceSimulation(simNodes)
    .force("link", forceLink(simLinks).id((d) => (d as SimNode).id).distance(46).strength(0.4))
    .force("charge", forceManyBody().strength(-90))
    .force("center", forceCenter(W / 2, H / 2))
    .force("collide", forceCollide<SimNode>().radius((d) => radius(d) + 3))
    .force("x", forceX(W / 2).strength(0.06))
    .force("y", forceY(H / 2).strength(0.08))
    .stop();
  sim.tick(280);

  const margin = 16;
  const placed = simNodes.map((n) => ({
    ...n,
    x: Math.max(margin, Math.min(W - margin, n.x ?? W / 2)),
    y: Math.max(margin, Math.min(H - margin, n.y ?? H / 2)),
    r: radius(n),
  }));
  const pos = new Map(placed.map((n) => [n.id, n]));

  const links = edges
    .map((e) => {
      const a = pos.get(e.s);
      const b = pos.get(e.t);
      return a && b ? { s: e.s, t: e.t, x1: a.x, y1: a.y, x2: b.x, y2: b.y } : null;
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);

  // Selective direct labels: biggest hubs only, skipping any label that would
  // collide with one already placed (dense centers stack otherwise).
  const labeled = new Set<string>();
  const taken: { x: number; y: number }[] = [];
  for (const n of [...placed].sort((a, b) => b.deg - a.deg)) {
    if (labeled.size >= 6) break;
    const lx = n.x;
    const ly = n.y - n.r - 5;
    if (taken.some((t) => Math.abs(t.x - lx) < 110 && Math.abs(t.y - ly) < 18)) continue;
    labeled.add(n.id);
    taken.push({ x: lx, y: ly });
  }
  return { nodes: placed, links, labeled };
}

function radius(n: { loc: number; deg: number }): number {
  return Math.max(4, Math.min(15, 3 + Math.sqrt(n.loc) / 4 + n.deg / 4));
}

function shortName(path: string): string {
  const parts = path.split("/");
  return parts.length > 2 ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}` : path;
}

export default function DepGraph({
  nodes,
  edges,
  ghBase,
}: {
  nodes: DepNode[];
  edges: DepEdge[];
  ghBase: string | null;
}) {
  const layout = useMemo(() => computeLayout(nodes, edges), [nodes, edges]);
  const [hover, setHover] = useState<string | null>(null);

  const neighbors = useMemo(() => {
    if (!hover) return null;
    const set = new Set<string>([hover]);
    for (const e of edges) {
      if (e.s === hover) set.add(e.t);
      if (e.t === hover) set.add(e.s);
    }
    return set;
  }, [hover, edges]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const n of nodes) c[n.cat] = (c[n.cat] ?? 0) + 1;
    return c;
  }, [nodes]);

  const hovered = hover ? layout.nodes.find((n) => n.id === hover) : null;

  return (
    <div>
      {/* Legend — identity is never color-alone */}
      <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-ink-muted">
        {(Object.keys(CAT_COLOR) as DepNode["cat"][])
          .filter((cat) => counts[cat])
          .map((cat) => (
            <span key={cat} className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: CAT_COLOR[cat] }} />
              {cat} <span className="opacity-60">{counts[cat]}</span>
            </span>
          ))}
        <span className="ml-auto opacity-60">size = lines · lines between files = imports</span>
      </div>

      <div className="relative mt-3 overflow-hidden rounded-xl border border-line bg-surface">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full"
          role="img"
          aria-label={`Dependency graph: ${nodes.length} files, ${edges.length} import relationships. The routes and structure sections list the same information as text.`}
        >
          {layout.links.map((l, i) => {
            const active = hover && (l.s === hover || l.t === hover);
            return (
              <line
                key={i}
                x1={l.x1}
                y1={l.y1}
                x2={l.x2}
                y2={l.y2}
                stroke={active ? "#FFB224" : "#3B3226"}
                strokeWidth={active ? 1.4 : 0.7}
                opacity={hover && !active ? 0.25 : 0.8}
              />
            );
          })}
          {layout.nodes.map((n) => {
            const dimmed = neighbors ? !neighbors.has(n.id) : false;
            const isHover = hover === n.id;
            return (
              <g key={n.id} opacity={dimmed ? 0.25 : 1}>
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={n.r + 5}
                  fill="transparent"
                  className="cursor-pointer"
                  onMouseEnter={() => setHover(n.id)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => {
                    if (ghBase) window.open(`${ghBase}/${n.id}`, "_blank", "noreferrer");
                  }}
                >
                  <title>{`${n.id} — ${n.loc} lines, ${n.deg} connections`}</title>
                </circle>
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={n.r}
                  fill={CAT_COLOR[n.cat]}
                  stroke={isHover ? "#FFB224" : "#14100B"}
                  strokeWidth={isHover ? 2 : 1.5}
                  pointerEvents="none"
                />
                {(layout.labeled.has(n.id) || isHover) && (
                  <text
                    x={n.x}
                    y={n.y - n.r - 5}
                    textAnchor="middle"
                    fontSize={10}
                    fontFamily="var(--font-plex-mono), monospace"
                    fill={isHover ? "#F3EDE3" : "#A79A85"}
                    pointerEvents="none"
                  >
                    {shortName(n.id)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {hovered && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-xs shadow-lg"
            style={{
              left: `${(hovered.x / W) * 100}%`,
              top: `${(hovered.y / H) * 100}%`,
              transform: `translate(${hovered.x > W * 0.6 ? "-105%" : "12px"}, ${hovered.y > H * 0.7 ? "-110%" : "8px"})`,
            }}
          >
            <p className="text-ink">{hovered.id}</p>
            <p className="mt-1 text-ink-muted">
              {hovered.loc} lines · {hovered.deg} connections ·{" "}
              <span style={{ color: CAT_COLOR[hovered.cat] }}>●</span> {hovered.cat}
            </p>
            {ghBase && <p className="mt-1 text-ink-muted opacity-70">click to open on GitHub</p>}
          </div>
        )}
      </div>
    </div>
  );
}
