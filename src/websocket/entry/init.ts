import logger from "src/common/log4js_config.js";
import { iterateAllKeys } from "../../common/migration/leveldb_to_postgresql.js";
import { init_monitor } from "../monitor/admin.js";
import { init_routes } from "../route/sys_route.js";
import { initial_default } from "./conn/default_conn.js";
import { init_texconn } from "./conn/texhub_conn.js";
import { Worker, isMainThread, parentPort } from "worker_threads";

export const initialize = () => {
  init_routes();
  initial_default();
  init_texconn();
  init_monitor();
  if (isMainThread) {
    // 主线程
    const worker = new Worker(new URL(import.meta.url)); // 创建子线程
    worker.on("message", (message) => {
      logger.info("Message from worker:", message);
      iterateAllKeys()
        .then(() => {
          console.log("Iteration completed.");
        })
        .catch((err: Error) => {
          console.error("Error during iteration:", err);
        });
    });
    worker.postMessage("Hello from main thread!");
  }
};
