import { parentPort } from "worker_threads";
import logger from "../log4js_config.js";

parentPort!.postMessage(doSyncSeperateWay());

function doSyncSeperateWay() {
  logger.info("start sync from leveldb to postgresql...");
}
