import { parentPort } from "worker_threads";
import { iterateAllLeveldbKeys } from "../migration/leveldb_to_postgresql.js";
import logger from "../log4js_config.js";

parentPort!.postMessage(doSyncSeperateWay());

function doSyncSeperateWay() {
  logger.info("start sync from leveldb to postgresql...");
  iterateAllLeveldbKeys();
}
