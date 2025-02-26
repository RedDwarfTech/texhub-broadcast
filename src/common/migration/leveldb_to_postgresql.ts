// @ts-ignore
import levelup from "levelup";
// @ts-ignore
import leveldown from "leveldown";
import { PostgresqlPersistance } from "../../storage/adapter/postgresql/postgresql_persistance.js";
const persistenceDir = process.env.YPERSISTENCE;
var db = levelup(leveldown(persistenceDir));
const postgresqlDb: PostgresqlPersistance = new PostgresqlPersistance();
export async function iterateAllKeys(): Promise<void> {
  const keyStream = db.createKeyStream();

  keyStream.on("data", (key: any) => {
    console.log("Key:", key.toString());
    const utf16Decoder = new TextDecoder("UTF-8");
    console.log("decode", utf16Decoder.decode(key));
    db.get(key, function (err: any, value: any) {
      if (err) return console.log("Ooops!", err); // likely the key was not found
      // Ta da!
      console.log("name=" + value);
    });
  });

  keyStream.on("end", () => {
    console.log("All keys have been iterated.");
  });

  keyStream.on("error", (err: Error) => {
    console.error("Error:", err);
  });
}
