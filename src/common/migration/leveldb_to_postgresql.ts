// @ts-ignore
import levelup from "levelup";
// @ts-ignore
import leveldown from "leveldown";
import { PostgresqlPersistance } from "../../storage/adapter/postgresql/postgresql_persistance.js";
import logger from "../log4js_config.js";
const persistenceDir = process.env.YPERSISTENCE;
var db = levelup(leveldown(persistenceDir));
const postgresqlDb: PostgresqlPersistance = new PostgresqlPersistance();

export async function iterateAllKeys(): Promise<void> {
  const keyStream = db.createKeyStream();
  keyStream.on("data", (key: any) => {
    db.get(key, async function (err: any, value: any) {
      if (err) return logger.error("Ooops!", err);
      await postgresqlDb.storeUpdateWithSource(key, value, 1);
    });
  });

  keyStream.on("end", () => {
    console.log("All keys have been iterated.");
  });

  keyStream.on("error", (err: Error) => {
    console.error("Error:", err);
  });
}
