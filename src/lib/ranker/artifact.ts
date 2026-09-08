import raw from "./model.v1.json";
import { validateModel, type TrainedModel } from "./model";

/**
 * The committed model artifact, produced by `npm run rank:train` from the
 * frozen dataset's training split. Loading validates it; anything malformed is
 * treated as absent, which means the baseline ranking runs. RANKER_OFF=1 is
 * the kill switch.
 */
export function loadRankerModel(): TrainedModel | undefined {
  if (process.env.RANKER_OFF === "1") return undefined;
  return validateModel(raw) ? raw : undefined;
}
