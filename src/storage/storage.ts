const persistenceDir = process.env.YPERSISTENCE;
// @ts-ignore
import * as Y from "yjs";
import { throttledFn } from "./appfile.js";
import { Persistence } from "../model/yjs/Persistence.js";
import { PostgresqlPersistance } from "./adapter/postgresql/postgresql_persistance.js";

export let persistencePostgresql: Persistence;

if (typeof persistenceDir === "string") {
  const postgresqlDb: PostgresqlPersistance = new PostgresqlPersistance();
  // postgresql
  persistencePostgresql = {
    provider: postgresqlDb,
    bindState: async (docName: string, ydoc: Y.Doc) => {
      const persistedYdoc: Y.Doc = await postgresqlDb.getYDoc(docName);
      const newUpdates: Uint8Array = Y.encodeStateAsUpdate(ydoc);
      await postgresqlDb.storeUpdate(docName, newUpdates);
      Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(persistedYdoc));
      ydoc.on("update", async (update: Uint8Array) => {
        await postgresqlDb.storeUpdate(docName, update);
        if (persistedYdoc) {
          throttledFn(docName, postgresqlDb);
        }
      });
    },
    writeState: async (docName: string, ydoc: Y.Doc) => {},
  };
}
