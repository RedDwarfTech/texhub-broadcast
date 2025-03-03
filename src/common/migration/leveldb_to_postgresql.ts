// @ts-ignore
import levelup from "levelup";
// @ts-ignore
import leveldown from "leveldown";
const leveldbPath = "/Users/xiaoqiangjiang/apps/texhub/yjs-storage-socketio";
import { PostgresqlPersistance } from "../../storage/adapter/postgresql/postgresql_persistance.js";
import logger from "../log4js_config.js";
import {
  keyEncoding,
  valueEncoding,
} from "../../storage/adapter/postgresql/postgresql_const.js";
const persistenceDir =
  process.env.APP_ENV == "development" ? leveldbPath : process.env.YPERSISTENCE;
var db = levelup(leveldown(persistenceDir));
const postgresqlDb: PostgresqlPersistance = new PostgresqlPersistance();

export function iterateAllKeys() {
  var keyCount = 0;
  var ar = new Set();
  const keyStream = db.createKeyStream();
  keyStream.on("data", async (key: any) => {
    keyCount = keyCount + 1;
    if (ar.has(key)) {
      logger.error("key already exists");
    }
    ar.add(key);
    let partsOrigin: any[] = keyEncoding.decode(key);
    await postgresqlDb.insertKeys(partsOrigin, partsOrigin);
    db.get(key, async function (err: any, value: any) {
      if (err) {
        return logger.error("Ooops!", err);
      }
      let partsOrigin: any[] = keyEncoding.decode(key);
      let decodeValue = valueEncoding.decode(value);
      const controlChars = ["\u0002", "\u0001", "\u0006", "\u0000", "\u0005"];
      let parts = partsOrigin.filter((i) => !controlChars.includes(i));
      if (parts.length > 2) {        
        handleGt2Keys(parts, partsOrigin, decodeValue);
      } else {
        logger.info("less than 2", parts);
      }
    });
  });

  keyStream.on("end", () => {
    logger.info(keyCount);
    logger.info(ar.size);
    logger.info("All keys have been iterated.");
  });

  keyStream.on("error", (err: Error) => {
    logger.info("Error:", err);
  });
}

async function handleGt2Keys(parts: any[], partsOrigin: any[], value: any) {
  let keyMap: Map<string, string> = new Map<string, string>();
  keyMap.set("version", parts[0]);
  keyMap.set("docName", parts[1]);
  keyMap.set("contentType", parts[2]);
  let clock = parts[3];
  if (parts[0] !== "v1") {
    logger.error("value not eqaul");
  }
  if (clock || Number(clock) === 0) {
    let clock = parseInt(parts[3], 16);
    if (isNaN(clock)) {
      logger.error("parse clock failed" + parts[3] + ", part:" + parts);
    }
    keyMap.set("clock", isNaN(clock) ? "0" : clock.toString());
    await postgresqlDb.storeUpdateWithSource(partsOrigin, value, keyMap);
  } else {
    logger.error("part is null");
    keyMap.set("clock", "0");
    await postgresqlDb.storeUpdateWithSource(partsOrigin, value, keyMap);
  }
}