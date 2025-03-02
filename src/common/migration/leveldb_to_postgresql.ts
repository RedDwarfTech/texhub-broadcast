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
    if(ar.has(key)){
      logger.error("key already exists");
    }
    ar.add(key);
    let partsOrigin: any[] = keyEncoding.decode(key);
    const controlChars = ["\u0002", "\u0001", "\u0006", "\u0000", "\u0005"];

    let parts = partsOrigin.filter((i) => !controlChars.includes(i));
    await postgresqlDb.insertKeys(partsOrigin, partsOrigin);
    db.get(key, async function (err: any, value: any) {
      if (err) {
        return logger.error("Ooops!", err);
      }
      let partsOrigin: any[] = keyEncoding.decode(key);
      let decodeValue = valueEncoding.decode(value);

      //const keyString = key.toString();
      const controlChars = ["\u0002", "\u0001", "\u0006", "\u0000", "\u0005"];
      //const parts: string[] = splitByControlChars(keyString, controlChars);
      let parts = partsOrigin.filter((i) => !controlChars.includes(i));
      if (parts.length > 2) {
        const decoder = new TextDecoder("utf-8");
        const text = decoder.decode(decodeValue);
        const text1 = decoder.decode(value);
        handleGt2Keys(parts, decodeValue);
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

async function handleGt2Keys(parts: any[], value: any) {
  let keyMap: Map<string, string> = new Map<string, string>();
  keyMap.set("version", parts[0]);
  keyMap.set("docName", parts[1]);
  keyMap.set("contentType", parts[2]);
  let clock = parts[3];
  if(parts[0] !== "v1"){
    logger.error("value not eqaul");
  }
  if (clock || Number(clock) === 0) {
    let clock = parseInt(parts[3], 16);
    if (isNaN(clock)) {
      logger.error("parse clock failed" + parts[3] + ", part:" + parts);
    }
    keyMap.set("clock", isNaN(clock) ? "0" : clock.toString());
    await postgresqlDb.storeUpdateWithSource(value, keyMap);
  } else {
    logger.error("part is null");
    keyMap.set("clock", "0");
    await postgresqlDb.storeUpdateWithSource(value, keyMap);
  }
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
