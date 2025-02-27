import logger from "../../common/log4js_config.js";
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
    const worker = new Worker(new URL(import.meta.url));
    worker.on("message", (message) => {
      logger.info("Message from worker:", message);
      iterateAllKeys();
    });
    worker.postMessage("Hello from main thread!");
  }
};
