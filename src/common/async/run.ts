import { Worker } from "node:worker_threads";

export const runSyncLeveldbToPgTask = (workerData: any) => {
  if (process.env.APP_ENV !== "development") {
    return;
  }
  return new Promise((resolve, reject) => {
    const workerURL = new URL("./sync_to_pg.js", import.meta.url);
    const worker = new Worker(workerURL, { workerData });
    worker.on("message", resolve);
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code !== 0) reject(new Error(`stopped with  ${code} exit code`));
    });
  });
};
