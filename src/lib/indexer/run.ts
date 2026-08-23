import { failJob, updateJob } from "../jobs";
import { fetchRepoMeta, parseRepoUrl } from "../github";
import { fetchRepo } from "./fetch";
import { walkRepo } from "./walk";
import { detectStack } from "./deps";
import { categorize, extractEntryPoints, extractRoutes } from "./structure";
import { buildDepGraph } from "./graph";
import { extractDataModel } from "./datamodel";
import { summarize } from "./summary";
import { countCommits } from "./history";
import { getJob } from "../jobs";

const FILE_PATH_CAP = 1500;

// Runs the full M0 pipeline, updating the job after each stage so the client
// can render progressively. Scheduled with `after()` from the API route so it
// keeps running once the response has been sent.
export async function runIndex(jobId: string, url: string, userToken?: string): Promise<void> {
  try {
    const ref = parseRepoUrl(url);
    if (!ref) throw new Error("That doesn't look like a GitHub repo. Try owner/repo or a full URL.");

    await updateJob(jobId, "meta");
    const meta = await fetchRepoMeta(ref, userToken);
    await updateJob(jobId, "clone", { meta });

    const { root, sha } = await fetchRepo(ref, userToken);

    await updateJob(jobId, "files");
    const { files, languages } = walkRepo(root);
    const totalLoc = files.reduce((s, f) => s + f.loc, 0);
    await updateJob(jobId, "stack", {
      // Recorded so a grill started later can be generated against this exact
      // tree instead of whatever HEAD has become since.
      sha: sha ?? undefined,
      languages,
      totalFiles: files.length,
      totalLoc,
      // Kept for Layer 4 phantom detection, which has to tell "this file is not
      // in the graph" from "this file does not exist". Capped so the job stays small.
      filePaths: files.map((f) => f.path).slice(0, FILE_PATH_CAP),
    });

    const stack = detectStack(root, files);
    await updateJob(jobId, "structure", { stack });

    const routes = extractRoutes(root, files, stack.frameworks);
    const entryPoints = extractEntryPoints(root, files);
    const categories = categorize(files);
    const graph = buildDepGraph(root, files);
    await updateJob(jobId, "schema", { routes, entryPoints, categories, graph });

    const models = extractDataModel(root, files);
    // One request, and §7's shelf wants it: a repo six commits deep is a
    // different proposition from one with four hundred.
    const commitDepth = await countCommits(ref, userToken);
    await updateJob(jobId, "summary", { models, commitDepth });

    const summary = await summarize((await getJob(jobId))?.map ?? {});
    await updateJob(jobId, "done", { summary });
  } catch (err) {
    await failJob(jobId, err instanceof Error ? err.message : "Indexing failed.");
  }
}
