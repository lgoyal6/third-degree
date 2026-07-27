import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { FileEntry } from "./walk";
import type { StackInfo } from "../types";

// dependency name (or prefix match with *) → display label
const FRAMEWORK_MARKERS: [string, string][] = [
  ["next", "Next.js"],
  ["react", "React"],
  ["vue", "Vue"],
  ["svelte", "Svelte"],
  ["@angular/core", "Angular"],
  ["astro", "Astro"],
  ["express", "Express"],
  ["fastify", "Fastify"],
  ["hono", "Hono"],
  ["koa", "Koa"],
  ["@nestjs/core", "NestJS"],
  ["@trpc/server", "tRPC"],
  ["graphql", "GraphQL"],
  ["prisma", "Prisma"],
  ["@prisma/client", "Prisma"],
  ["drizzle-orm", "Drizzle"],
  ["mongoose", "Mongoose"],
  ["@supabase/supabase-js", "Supabase"],
  ["firebase", "Firebase"],
  ["tailwindcss", "Tailwind"],
  ["zod", "Zod"],
  ["stripe", "Stripe"],
  ["next-auth", "NextAuth"],
  ["@clerk/nextjs", "Clerk"],
  ["socket.io", "Socket.IO"],
  ["bullmq", "BullMQ"],
  ["@anthropic-ai/sdk", "Anthropic"],
  ["openai", "OpenAI"],
];

export function detectStack(root: string, files: FileEntry[]): StackInfo {
  const pkgPaths = files
    .filter((f) => f.path.endsWith("package.json") && f.path.split("/").length <= 3)
    .slice(0, 10);

  const allDeps = new Set<string>();
  let scripts: Record<string, string> = {};
  for (const p of pkgPaths) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(root, p.path), "utf8"));
      for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
        allDeps.add(dep);
      }
      if (p.path === "package.json") scripts = pkg.scripts ?? {};
    } catch {
      // malformed package.json — skip
    }
  }

  const frameworks: string[] = [];
  for (const [marker, label] of FRAMEWORK_MARKERS) {
    if (allDeps.has(marker) && !frameworks.includes(label)) frameworks.push(label);
  }

  let packageManager: string | null = null;
  if (existsSync(path.join(root, "pnpm-lock.yaml"))) packageManager = "pnpm";
  else if (existsSync(path.join(root, "yarn.lock"))) packageManager = "yarn";
  else if (existsSync(path.join(root, "bun.lock")) || existsSync(path.join(root, "bun.lockb"))) packageManager = "bun";
  else if (existsSync(path.join(root, "package-lock.json"))) packageManager = "npm";

  return { frameworks, packageManager, dependencies: allDeps.size, scripts };
}
