import { startEngineWorker } from '../engine/worker-main';

// Unlisted script: built as a standalone classic worker script (engine-worker.js) and started by the offscreen document.
export default defineUnlistedScript(() => {
  startEngineWorker();
});
