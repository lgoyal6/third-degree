import { readFileSync } from "node:fs";
import path from "node:path";
import type { FileEntry } from "./walk";
import type { CategoryNode, RouteInfo } from "../types";

const CODE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

function read(root: string, rel: string): string {
  try {
    return readFileSync(path.join(root, rel), "utf8");
  } catch {
    return "";
  }
}

// ---------- Routes ----------

// app/(marketing)/blog/[slug]/page.tsx → /blog/[slug]
function appDirToRoute(rel: string): string {
  const parts = rel.split("/");
  const appIdx = parts.lastIndexOf("app");
  const segments = parts
    .slice(appIdx + 1, -1)
    .filter((s) => !s.startsWith("(") && !s.startsWith("@"));
  return "/" + segments.join("/");
}

function pagesDirToRoute(rel: string): string {
  const parts = rel.split("/");
  const pagesIdx = parts.lastIndexOf("pages");
  const segments = parts.slice(pagesIdx + 1);
  const last = segments.pop() ?? "";
  const base = last.replace(/\.(tsx|ts|jsx|js|mdx?)$/, "");
  if (base !== "index") segments.push(base);
  return "/" + segments.join("/");
}

export function extractRoutes(root: string, files: FileEntry[], frameworks: string[]): RouteInfo[] {
  const routes: RouteInfo[] = [];

  for (const f of files) {
    if (!CODE_EXTS.has(f.ext) && f.ext !== ".mdx") continue;
    const p = f.path;
    const inApp = /(^|\/)app\//.test(p);
    const inPages = /(^|\/)pages\//.test(p);
    const base = p.split("/").pop() ?? "";

    if (inApp && /^page\.(tsx|ts|jsx|js|mdx)$/.test(base)) {
      routes.push({ kind: "page", method: "*", path: appDirToRoute(p), file: p });
    } else if (inApp && /^route\.(ts|js)$/.test(base)) {
      const src = read(root, p);
      const methods = HTTP_METHODS.filter((m) =>
        new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${m}\\b`).test(src),
      );
      for (const m of methods.length ? methods : ["*"]) {
        routes.push({ kind: "api", method: m, path: appDirToRoute(p), file: p });
      }
    } else if (inPages && !p.includes("/pages/api/") && /\.(tsx|jsx|mdx)$/.test(base) && !base.startsWith("_")) {
      routes.push({ kind: "page", method: "*", path: pagesDirToRoute(p), file: p });
    } else if (inPages && p.includes("/pages/api/")) {
      routes.push({ kind: "api", method: "*", path: pagesDirToRoute(p), file: p });
    } else if (/^middleware\.(ts|js)$/.test(base) && p.split("/").length <= 2) {
      routes.push({ kind: "middleware", method: "*", path: "(matched requests)", file: p });
    }
  }

  // Express / Hono / Fastify style: app.get('/path'), router.post("/path")
  const hasServerFramework = frameworks.some((fw) => ["Express", "Hono", "Fastify", "Koa"].includes(fw));
  if (hasServerFramework) {
    const serverRouteRe = /\b(?:app|router|server|api)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g;
    for (const f of files) {
      if (!CODE_EXTS.has(f.ext) || f.loc === 0 || f.loc > 3000) continue;
      const src = read(root, f.path);
      let m;
      while ((m = serverRouteRe.exec(src)) !== null) {
        routes.push({ kind: "api", method: m[1].toUpperCase(), path: m[2], file: f.path });
      }
    }
  }

  routes.sort((a, b) => a.path.localeCompare(b.path));
  return routes.slice(0, 200);
}

// ---------- Entry points ----------

export function extractEntryPoints(root: string, files: FileEntry[]): string[] {
  const candidates = [
    "src/app/layout.tsx", "app/layout.tsx",
    "src/pages/_app.tsx", "pages/_app.tsx",
    "src/index.ts", "src/index.tsx", "src/main.ts", "src/main.tsx",
    "src/server.ts", "server.ts", "index.ts", "index.js", "src/index.js",
    "src/middleware.ts", "middleware.ts",
    "next.config.ts", "next.config.js", "next.config.mjs",
  ];
  const present = new Set(files.map((f) => f.path));
  const entries = candidates.filter((c) => present.has(c));

  try {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    if (pkg.main && present.has(pkg.main.replace(/^\.\//, ""))) {
      entries.unshift(pkg.main.replace(/^\.\//, ""));
    }
  } catch {
    // no root package.json
  }
  return [...new Set(entries)].slice(0, 8);
}

// ---------- Categories ----------

type Bucket = { files: number; loc: number; sub: Map<string, { files: number; loc: number; samples: string[] }> };

function add(bucket: Bucket, sub: string, f: FileEntry) {
  bucket.files += 1;
  bucket.loc += f.loc;
  const s = bucket.sub.get(sub) ?? { files: 0, loc: 0, samples: [] };
  s.files += 1;
  s.loc += f.loc;
  if (s.samples.length < 3) s.samples.push(f.path);
  bucket.sub.set(sub, s);
}

export type BucketCat = "Frontend" | "Backend" | "Data" | "Infra";

// Path-heuristic bucketing per BUILD_PLAN §3 Layer 0. Deliberately coarse for
// M0 — the TS-compiler symbol graph refines this in M3.
export function bucketFor(f: FileEntry): { cat: BucketCat; sub: string } | null {
  const p = f.path.toLowerCase();
  const base = p.split("/").pop() ?? "";

  // Infra
  if (
    p.startsWith(".github/") || base === "dockerfile" || p.includes("docker-compose") ||
    base === "vercel.json" || base === "fly.toml" || p.includes("terraform") ||
    /\.(ya?ml)$/.test(base) && (p.includes("ci") || p.includes("workflow") || p.includes("deploy"))
  ) {
    return { cat: "Infra", sub: p.startsWith(".github/") ? "CI/CD" : "Deployment" };
  }
  if (/(^|\/)(next|tailwind|postcss|vite|webpack|tsconfig|eslint|prettier|babel)[.\w-]*\.(js|ts|mjs|cjs|json)$/.test(p)) {
    return { cat: "Infra", sub: "Build config" };
  }

  // Data
  if (base === "schema.prisma" || p.includes("/prisma/")) return { cat: "Data", sub: "Prisma schema" };
  if (p.includes("migration") && (f.ext === ".sql" || f.ext === ".ts" || f.ext === ".js")) return { cat: "Data", sub: "Migrations" };
  if (f.ext === ".sql") return { cat: "Data", sub: "SQL" };
  if (/(^|\/)(db|database|drizzle|models|schema|schemas)\//.test(p) && CODE_EXTS.has(f.ext)) {
    return { cat: "Data", sub: "Schema & models" };
  }

  // Backend
  if (/(^|\/)(app|pages)\/api\//.test(p) || /(^|\/)app\/.*\/route\.(ts|js)$/.test(p)) return { cat: "Backend", sub: "API routes" };
  if (/auth/.test(p) && CODE_EXTS.has(f.ext)) return { cat: "Backend", sub: "Auth" };
  if (/(queue|worker|cron|jobs?)\//.test(p) && CODE_EXTS.has(f.ext)) return { cat: "Backend", sub: "Background jobs" };
  if (/(^|\/)(server|api|services|controllers|routes)\//.test(p) && CODE_EXTS.has(f.ext)) return { cat: "Backend", sub: "Business logic" };
  if (/(repository|repositories|dao|data-access)\//.test(p) && CODE_EXTS.has(f.ext)) return { cat: "Backend", sub: "Data access" };
  if (/^middleware\.(ts|js)$/.test(base)) return { cat: "Backend", sub: "Middleware" };

  // Frontend
  if (/(^|\/)(components?|ui)\//.test(p)) return { cat: "Frontend", sub: "Components" };
  if (/(^|\/)hooks?\//.test(p)) return { cat: "Frontend", sub: "Hooks" };
  if (f.ext === ".css" || f.ext === ".scss") return { cat: "Frontend", sub: "Styles" };
  if (/(^|\/)(app|pages)\//.test(p) && /\.(tsx|jsx|mdx)$/.test(base)) return { cat: "Frontend", sub: "Pages & layouts" };
  if (p.startsWith("public/")) return { cat: "Frontend", sub: "Static assets" };
  if (/\.(tsx|jsx|vue|svelte)$/.test(base)) return { cat: "Frontend", sub: "Components" };

  // Remaining shared code → Backend/shared lib
  if (/(^|\/)(lib|utils?|helpers?|shared|core)\//.test(p) && CODE_EXTS.has(f.ext)) {
    return { cat: "Backend", sub: "Shared lib" };
  }
  return null;
}

export function categorize(files: FileEntry[]): CategoryNode[] {
  const buckets: Record<string, Bucket> = {
    Frontend: { files: 0, loc: 0, sub: new Map() },
    Backend: { files: 0, loc: 0, sub: new Map() },
    Data: { files: 0, loc: 0, sub: new Map() },
    Infra: { files: 0, loc: 0, sub: new Map() },
  };

  for (const f of files) {
    const bucket = bucketFor(f);
    if (bucket) add(buckets[bucket.cat], bucket.sub, f);
  }

  return Object.entries(buckets)
    .map(([name, b]) => ({
      name,
      files: b.files,
      loc: b.loc,
      children: [...b.sub.entries()]
        .map(([sub, s]) => ({ name: sub, files: s.files, loc: s.loc, children: [], sampleFiles: s.samples }))
        .sort((a, c) => c.loc - a.loc),
      sampleFiles: [],
    }))
    .filter((c) => c.files > 0)
    .sort((a, b) => b.loc - a.loc);
}
