import { parentPort, workerData } from "node:worker_threads";
import { parseSave } from "./parser/index.ts";
import { createSnapshot } from "./storage.ts";
import { statSync, renameSync } from "node:fs";
try {
  const started = Date.now();
  const { file, temporary, destination, metadata } = workerData;
  const before = statSync(file);
  if (before.size !== metadata.sourceSize || before.mtimeMs !== metadata.sourceMtime)
    throw new Error("The save changed before import began. Refresh the save list and retry.");
  const result = parseSave(file, (progress, message) =>
    parentPort?.postMessage({ type: "progress", progress, message }),
  );
  createSnapshot(temporary, result, metadata);
  const after = statSync(file);
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs)
    throw new Error("The save changed during import. Wait for saving to finish and retry.");
  renameSync(temporary, destination);
  parentPort?.postMessage({ type: "complete", playerCount: result.players.length, elapsedMs: Date.now()-started, peakRssBytes:process.resourceUsage().maxRSS*1024 });
} catch (e) {
  parentPort?.postMessage({ type: "error", message: e instanceof Error ? e.message : String(e) });
  process.exitCode = 1;
}
