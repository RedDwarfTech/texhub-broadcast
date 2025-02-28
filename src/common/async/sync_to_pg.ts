import { parentPort } from "worker_threads";
import { iterateAllKeys } from "../migration/leveldb_to_postgresql.js";
import logger from "../log4js_config.js";

parentPort!.postMessage(getFibonacciNumber());

function getFibonacciNumber() {
  logger.info("start sync...");
  iterateAllKeys();
}
