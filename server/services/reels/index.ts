/**
 * Point d'entrée des Reels : enregistre les traitements de la file et démarre
 * le worker.
 */

import { registerReelJobHandler, startReelWorker } from "./queue";
import { runVideoReelJob } from "./videoPipeline";
import { runImagesReelJob } from "./imagesPipeline";

export function startReelProcessing(): Promise<void> {
  registerReelJobHandler("video", runVideoReelJob);
  registerReelJobHandler("images", runImagesReelJob);
  return startReelWorker();
}
