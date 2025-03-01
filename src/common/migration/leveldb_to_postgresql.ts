// @ts-ignore
import levelup from "levelup";
// @ts-ignore
import leveldown from "leveldown";
import { PostgresqlPersistance } from "../../storage/adapter/postgresql/postgresql_persistance.js";
import logger from "../log4js_config.js";
const persistenceDir = "/Users/xiaoqiangjiang/apps/texhub/yjs-storage-socketio"; //process.env.YPERSISTENCE;
var db = levelup(leveldown(persistenceDir));
const postgresqlDb: PostgresqlPersistance = new PostgresqlPersistance();

export function iterateAllKeys() {
  const keyStream = db.createKeyStream();
  keyStream.on("data", (key: string) => {
    db.get(key, async function (err: any, value: any) {
      if (err) return logger.error("Ooops!", err);
      const keyString = key.toString();
      let replacedText = keyString
        .replaceAll("", "")
        .replaceAll("0x00", "")
        .replaceAll(/\u0000/g, "");
      const controlChars = ["\u0002", "\u0001", "\u0006"];
      //const parts = splitByControlChars(keyString, controlChars).filter((part) => part !== '');

      let keyMap: Map<string, string> = new Map<string, string>();
      //keyMap.set("version", parts[0]);
      //keyMap.set("docName", parts[1]);
      await postgresqlDb.storeUpdateWithSource(value, keyMap);
    });
  });

  keyStream.on("end", () => {
    console.log("All keys have been iterated.");
  });

  keyStream.on("error", (err: Error) => {
    console.error("Error:", err);
  });
}
