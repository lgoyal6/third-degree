import { failJob, updateJob } from "../jobs";
import { fetchRepoMeta, parseRepoUrl } from "../github";
import { cloneRepo } from "./clone";
import { walkRepo } from "./walk";
import { detectStack } from "./deps";
import { categorize, extractEntryPoints, extractRoutes } from "./structure";
import { extractDataModel } from "./datamodel";
import { summarize } from "./summary";
import { getJob } from "../jobs";

// Runs the full M0 pipeline, updating the job after each stage so the client
// can render progressively. Called fire-and-forget from the API route.
export async function runIndex(jobId: string, url: string): Promise<void> {
  try {
    const ref = parseRepoUrl(url);
    if (!ref) throw new Error("That doesn't look like a GitHub repo. Try owner/repo or a full URL.");

    updateJob(jobId, "meta");
    const meta = await fetchRepoMeta(ref);
    updateJob(jobId, "clone", { meta });

    const root = await cloneRepo(ref);

    updateJob(jobId, "files");
    const { files, languages } = walkRepo(root);
    const totalLoc = files.reduce((s, f) => s + f.loc, 0);
    updateJob(jobId, "stack", { languages, totalFiles: files.length, totalLoc });

    const stack = detectStack(root, files);
    updateJob(jobId, "structure", { stack });

    const routes = extractRoutes(root, files, stack.frameworks);
    const entryPoints = extractEntryPoints(root, files);
    const categories = categorize(files);
    updateJob(jobId, "schema", { routes, entryPoints, categories });

    const models = extractDataModel(root, files);
    updateJob(jobId, "summary", { models });

    const summary = await summarize(getJob(jobId)?.map ?? {});
    updateJob(jobId, "done", { summary });
  } catch (err) {
    failJob(jobId, err instanceof Error ? err.message : "Indexing failed.");
  }
}
