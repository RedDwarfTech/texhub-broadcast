// @ts-ignore
import levelup from "levelup";
// @ts-ignore
import leveldown from "leveldown";
const leveldbPath = "/Users/xiaoqiangjiang/apps/texhub/yjs-storage-socketio";
import { PostgresqlPersistance } from "../../storage/adapter/postgresql/postgresql_persistance.js";
import logger from "../log4js_config.js";
const persistenceDir =
  process.env.APP_ENV == "development" ? leveldbPath : process.env.YPERSISTENCE;
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
      const controlChars = ["\u0002", "\u0001", "\u0006", "\u0000", "\u0005"];
      const parts = splitByControlChars(keyString, controlChars);
      if (parts.length > 2) {
        let keyMap: Map<string, string> = new Map<string, string>();
        keyMap.set("version", parts[0]);
        keyMap.set("docName", parts[1]);
        keyMap.set("contentType", parts[2]);
        if (parts[3]) {
          let clock = parseInt(parts[3], 16);
          keyMap.set("clock", isNaN(clock) ? "0" : clock.toString());
          await postgresqlDb.storeUpdateWithSource(value, keyMap);
        } else {
          let clock = 0;
          keyMap.set("clock", "0");
          await postgresqlDb.storeUpdateWithSource(value, keyMap);
        }
      }
    });
  });

  keyStream.on("end", () => {
    console.log("All keys have been iterated.");
  });

  keyStream.on("error", (err: Error) => {
    console.error("Error:", err);
  });
}

function splitByControlChars(str: string, controlChars: string[]): string[] {
  const controlCharSet = new Set(controlChars);
  const result: string[] = [];
  let current = "";

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (controlCharSet.has(char)) {
      if (current) {
        result.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }

  if (current) {
    result.push(current);
  }

  return result;
}
