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

// Separation by lightness inside the lamp's own warm range, rather than by hue.
// The previous blue/green/purple set had better hue distance but read as a
// stock chart palette dropped into an amber room, which is the one thing §7
// says this product must never look like. Category identity is carried in the
// legend and tooltip as text, never by color alone. The bright UI amber
// (#FFB224) stays reserved for hover.
const CAT_COLOR: Record<DepNode["cat"], string> = {
  Frontend: "#EFE1C8",
  Backend: "#E0921F",
  Data: "#D2691E",
  Infra: "#8A7A62",
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
  labeled: Map<string, { x: number; y: number; anchor: "middle" | "start" | "end"; w: number }>;
  view: { x: number; y: number; w: number; h: number };
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

  // The hubs are the point of this picture, so the top six by degree always get
  // a name. Placement picks whichever side overlaps least rather than skipping,
  // because an unlabeled hub is worse than a label that grazes a small node.
  const labeled = new Map<string, { x: number; y: number; anchor: "middle" | "start" | "end"; w: number }>();
  const taken: { x: number; y: number; w: number; h: number }[] = [];
  const charW = 5.6;
  for (const n of [...placed].sort((a, b) => b.deg - a.deg).slice(0, 6)) {
    const w = shortName(n.id).length * charW;
    const candidates: { x: number; y: number; anchor: "middle" | "start" | "end"; box: [number, number, number, number] }[] = [
      { x: n.x, y: n.y - n.r - 8, anchor: "middle", box: [n.x - w / 2, n.y - n.r - 18, w, 12] },
      { x: n.x, y: n.y + n.r + 15, anchor: "middle", box: [n.x - w / 2, n.y + n.r + 5, w, 12] },
      { x: n.x + n.r + 7, y: n.y + 3.5, anchor: "start", box: [n.x + n.r + 7, n.y - 6, w, 12] },
      { x: n.x - n.r - 7, y: n.y + 3.5, anchor: "end", box: [n.x - n.r - 7 - w, n.y - 6, w, 12] },
      { x: n.x, y: n.y - n.r - 22, anchor: "middle", box: [n.x - w / 2, n.y - n.r - 32, w, 12] },
      { x: n.x, y: n.y + n.r + 29, anchor: "middle", box: [n.x - w / 2, n.y + n.r + 19, w, 12] },
    ];
    const scored = candidates.map((c) => {
      const [bx, by, bw, bh] = c.box;
      const nodeHits = placed.filter(
        (o) => o.id !== n.id && o.x + o.r > bx && o.x - o.r < bx + bw && o.y + o.r > by && o.y - o.r < by + bh,
      ).length;
      const labelHits = taken.filter(
        (t) => bx < t.x + t.w && t.x < bx + bw && by < t.y + t.h && t.y < by + bh,
      ).length;
      return { c, score: nodeHits + labelHits * 4 };
    });
    scored.sort((a, b) => a.score - b.score);
    const best = scored[0].c;
    labeled.set(n.id, { x: best.x, y: best.y, anchor: best.anchor, w });
    taken.push({ x: best.box[0], y: best.box[1], w: best.box[2], h: best.box[3] });
  }

  // The simulation settles wherever it settles; framing it to a fixed 860x540
  // left the blob swimming in dead space. Crop to what was actually drawn.
  const pad = 30;
  const xs = placed.map((n) => n.x);
  const ys = placed.map((n) => n.y);
  let vx = Math.min(...xs) - pad;
  let vy = Math.min(...ys) - pad - 8;
  let vw = Math.max(...xs) - Math.min(...xs) + pad * 2;
  let vh = Math.max(...ys) - Math.min(...ys) + pad * 2 + 8;

  // A thin repo settles into a tiny cluster, and cropping to it would scale five
  // dots up to beach balls. Floor the frame, then hold the aspect in a band so
  // the box never renders as a slot or a tower.
  // A twelve-file repo does not deserve the same canvas as a two-hundred-file
  // one: floored at the same height it renders five dots in a 550px void.
  const sparse = placed.length <= 12;
  const MIN_W = 460;
  const MIN_H = sparse ? 200 : 300;
  if (vw < MIN_W) {
    vx -= (MIN_W - vw) / 2;
    vw = MIN_W;
  }
  if (vh < MIN_H) {
    vy -= (MIN_H - vh) / 2;
    vh = MIN_H;
  }
  const aspect = vw / vh;
  if (aspect < 1.2) {
    const widened = vh * 1.2;
    vx -= (widened - vw) / 2;
    vw = widened;
  } else if (aspect > (sparse ? 2.6 : 1.9)) {
    const heightened = vw / (sparse ? 2.6 : 1.9);
    vy -= (heightened - vh) / 2;
    vh = heightened;
  }
  return { nodes: placed, links, labeled, view: { x: vx, y: vy, w: vw, h: vh } };
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
        <span className="ml-auto opacity-60">dot size = lines of code · link = an import</span>
      </div>

      <div className="relative mt-3 overflow-hidden rounded-xl border border-line bg-surface">
        <svg
          viewBox={`${layout.view.x} ${layout.view.y} ${layout.view.w} ${layout.view.h}`}
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
                stroke={active ? "#FFB224" : "#3E4652"}
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
              </g>
            );
          })}
          {/* Labels last: inside the node groups they were painted over by every
              node drawn after them, which is why hub names came out clipped. */}
          {layout.nodes
            .filter((n) => layout.labeled.has(n.id) || hover === n.id)
            .map((n) => {
              const spot = layout.labeled.get(n.id) ?? {
                x: n.x,
                y: n.y - n.r - 8,
                anchor: "middle" as const,
                w: shortName(n.id).length * 5.6,
              };
              // A plate rather than a stroke halo: over a dense center, outlined
              // text still reads as struck through by whatever it crosses.
              const plateX =
                spot.anchor === "middle" ? spot.x - spot.w / 2 : spot.anchor === "start" ? spot.x : spot.x - spot.w;
              return (
                <g
                  key={`label-${n.id}`}
                  opacity={neighbors && !neighbors.has(n.id) ? 0.2 : 1}
                  pointerEvents="none"
                >
                  <rect
                    x={plateX - 4}
                    y={spot.y - 9}
                    width={spot.w + 8}
                    height={13}
                    rx={3}
                    fill="#08090B"
                    fillOpacity={0.82}
                    stroke={hover === n.id ? "#FFB224" : "#3E4652"}
                    strokeWidth={0.6}
                  />
                  <text
                    x={spot.x}
                    y={spot.y}
                    textAnchor={spot.anchor}
                    fontSize={10}
                    fontFamily="var(--font-plex-mono), monospace"
                    fill={hover === n.id ? "#FFC95C" : "#C9BCA6"}
                  >
                    {shortName(n.id)}
                  </text>
                </g>
              );
            })}
        </svg>

        {hovered && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-xs shadow-lg"
            style={{
              left: `${((hovered.x - layout.view.x) / layout.view.w) * 100}%`,
              top: `${((hovered.y - layout.view.y) / layout.view.h) * 100}%`,
              transform: `translate(${hovered.x > layout.view.x + layout.view.w * 0.6 ? "-105%" : "12px"}, ${
                hovered.y > layout.view.y + layout.view.h * 0.7 ? "-110%" : "8px"
              })`,
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
