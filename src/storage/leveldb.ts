const persistenceDir = process.env.YPERSISTENCE;
// @ts-ignore
import * as Y from "yjs";
// @ts-ignore
import { LeveldbPersistence } from "y-leveldb";
import { throttledFn } from "./appfile.js";
import { Persistence } from "../model/yjs/Persistence.js";
import { PostgresqlPersistance } from "./adapter/postgresql/postgresql_persistance.js";

export let persistence: Persistence;
export let persistencePostgresql: Persistence;

if (typeof persistenceDir === "string") {
  console.info('Persisting documents to "' + persistenceDir + '"');
  const ldb = new LeveldbPersistence(persistenceDir);
  persistence = {
    provider: ldb,
    bindState: async (docName: string, ydoc: Y.Doc) => {
      const persistedYdoc = await ldb.getYDoc(docName);
      const newUpdates = Y.encodeStateAsUpdate(ydoc);
      ldb.storeUpdate(docName, newUpdates);
      Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(persistedYdoc));
      ydoc.on("update", (update) => {
        ldb.storeUpdate(docName, update);
        if (persistedYdoc) {
          throttledFn(docName, ldb);
        }
      });
    },
    writeState: async (docName: string, ydoc: Y.Doc) => {},
  };

  // postgresql
  const postgresql = new PostgresqlPersistance();

}
