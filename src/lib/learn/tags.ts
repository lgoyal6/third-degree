/**
 * Concept tags are emergent, not canonical (BUILD_PLAN §8): the model invents
 * free-form slugs and we normalize them, rather than maintaining an ontology.
 * Normalization is what makes cross-repo resurfacing work later, since two
 * repos will phrase the same idea differently.
 */
const MAX_TAGS = 3;
const MAX_LEN = 40;

export function normalizeTags(raw: (string | undefined | null)[]): string[] {
  const out: string[] = [];
  for (const value of raw) {
    const slug = (value ?? "")
      .toLowerCase()
      .trim()
      .replace(/[\s_]+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-{2,}/g, "-")
      .replace(/^-|-$/g, "");
    if (!slug || slug.length > MAX_LEN || out.includes(slug)) continue;
    out.push(slug);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/**
 * The deterministic generators already know what they are testing, so their
 * tags are fixed rather than model-supplied. Layer 1 snippet questions get
 * theirs from the model, because only it has read the code.
 */
export const KIND_TAGS: Record<string, string[]> = {
  "route-handler": ["file-based-routing"],
  "route-models": ["route-data-flow"],
  imports: ["import-blast-radius"],
  "call-sites": ["call-site-blast-radius"],
  "commit-scope": ["change-surface"],
  "field-refs": ["schema-rename-blast-radius"],
  overview: ["system-overview"],
};
