// @ts-ignore
import levelup from "levelup";
// @ts-ignore
import leveldown from "leveldown";
const leveldbPath = "/Users/xiaoqiangjiang/apps/texhub/yjs-storage-socketio";
import { PostgresqlPersistance } from "@storage/adapter/postgresql/postgresql_persistance.js";
import logger from "../log4js_config.js";
import {
  keyEncoding,
  valueEncoding,
} from "@/storage/adapter/postgresql/conf/postgresql_const.js";
const persistenceDir =
  process.env.APP_ENV == "development" ? leveldbPath : process.env.YPERSISTENCE;
var db = levelup(leveldown(persistenceDir));
const postgresqlDb: PostgresqlPersistance = new PostgresqlPersistance();

export function iterateAllLeveldbKeys() {
  const keyStream = db.createKeyStream();
  keyStream.on("data", async (key: any) => {
    db.get(key, async function (err: any, value: any) {
      if (err) {
        return logger.error("Ooops!", err);
      }
      let partsOrigin: any[] = keyEncoding.decode(key);
      let decodeValue = valueEncoding.decode(value);
      await postgresqlDb.storeUpdateWithSource(partsOrigin, decodeValue);
    });
  });

  keyStream.on("end", () => {
    logger.info("All keys have been iterated.");
  });

  keyStream.on("error", (err: Error) => {
    logger.error("sync data from level db to postgresql Error:", err);
  });
}