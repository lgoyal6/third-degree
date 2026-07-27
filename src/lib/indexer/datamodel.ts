import { readFileSync } from "node:fs";
import path from "node:path";
import type { FileEntry } from "./walk";
import type { ModelInfo } from "../types";

const MAX_MODELS = 30;
const MAX_FIELDS = 12;

function read(root: string, rel: string): string {
  try {
    return readFileSync(path.join(root, rel), "utf8");
  } catch {
    return "";
  }
}

function parsePrisma(src: string, file: string): ModelInfo[] {
  const models: ModelInfo[] = [];
  const modelRe = /model\s+(\w+)\s*\{([^}]*)\}/g;
  let m;
  while ((m = modelRe.exec(src)) !== null) {
    const fields = m[2]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("//") && !l.startsWith("@@"))
      .map((l) => {
        const [name, type] = l.split(/\s+/);
        return { name, type: type ?? "" };
      })
      .filter((f) => f.name && f.type)
      .slice(0, MAX_FIELDS);
    models.push({ name: m[1], fields, source: "prisma", file });
  }
  return models;
}

function parseDrizzle(src: string, file: string): ModelInfo[] {
  const models: ModelInfo[] = [];
  const tableRe = /(?:pg|mysql|sqlite)Table\(\s*['"`](\w+)['"`]\s*,\s*\{([\s\S]*?)\}\s*[,)]/g;
  let m;
  while ((m = tableRe.exec(src)) !== null) {
    const fields = [...m[2].matchAll(/(\w+)\s*:\s*(\w+)\(/g)]
      .map(([, name, type]) => ({ name, type }))
      .slice(0, MAX_FIELDS);
    models.push({ name: m[1], fields, source: "drizzle", file });
  }
  return models;
}

function parseSql(src: string, file: string): ModelInfo[] {
  const models: ModelInfo[] = [];
  const tableRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?\s*\(([\s\S]*?)\);/gi;
  let m;
  while ((m = tableRe.exec(src)) !== null) {
    const fields = m[2]
      .split(",")
      .map((l) => l.trim())
      .filter((l) => l && !/^(PRIMARY|FOREIGN|UNIQUE|CONSTRAINT|CHECK|KEY)/i.test(l))
      .map((l) => {
        const parts = l.split(/\s+/);
        return { name: parts[0]?.replace(/["'`]/g, "") ?? "", type: parts[1] ?? "" };
      })
      .filter((f) => f.name)
      .slice(0, MAX_FIELDS);
    models.push({ name: m[1], fields, source: "sql", file });
  }
  return models;
}

function parseMongoose(src: string, file: string): ModelInfo[] {
  const models: ModelInfo[] = [];
  const modelRe = /model(?:<[^>]*>)?\(\s*['"`](\w+)['"`]/g;
  let m;
  while ((m = modelRe.exec(src)) !== null) {
    models.push({ name: m[1], fields: [], source: "mongoose", file });
  }
  return models;
}

export function extractDataModel(root: string, files: FileEntry[]): ModelInfo[] {
  const models: ModelInfo[] = [];
  const seen = new Set<string>();

  for (const f of files) {
    if (models.length >= MAX_MODELS) break;
    let found: ModelInfo[] = [];
    if (f.path.endsWith(".prisma")) {
      found = parsePrisma(read(root, f.path), f.path);
    } else if (f.ext === ".sql" && f.loc > 0) {
      found = parseSql(read(root, f.path), f.path);
    } else if ((f.ext === ".ts" || f.ext === ".js") && /(schema|db|table|model)/i.test(f.path) && f.loc > 0 && f.loc < 3000) {
      const src = read(root, f.path);
      if (src.includes("Table(")) found = parseDrizzle(src, f.path);
      else if (src.includes("mongoose")) found = parseMongoose(src, f.path);
    }
    for (const model of found) {
      if (!seen.has(model.name)) {
        seen.add(model.name);
        models.push(model);
      }
    }
  }
  return models.slice(0, MAX_MODELS);
}
