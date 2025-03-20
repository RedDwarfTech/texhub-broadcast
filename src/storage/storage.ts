const persistenceDir = process.env.YPERSISTENCE;
// @ts-ignore
import * as Y from "yjs";
import { throttledFn } from "./appfile.js";
import { Persistence } from "../model/yjs/Persistence.js";
import { PostgresqlPersistance } from "./adapter/postgresql/postgresql_persistance.js";
import logger from "../common/log4js_config.js";
import { binary, decoding } from "lib0";

export let persistencePostgresql: Persistence;

if (typeof persistenceDir === "string") {
  const postgresqlDb: PostgresqlPersistance = new PostgresqlPersistance();
  // postgresql
  persistencePostgresql = {
    provider: postgresqlDb,
    bindState: async (docName: string, ydoc: Y.Doc) => {
      try {
        const persistedYdoc: Y.Doc = await postgresqlDb.getYDoc(docName);
        const newUpdates: Uint8Array = Y.encodeStateAsUpdate(ydoc);
        await postgresqlDb.storeUpdate(docName, newUpdates);
        Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(persistedYdoc));
        ydoc.on("update", async (update: Uint8Array) => {
          const decoder = decoding.createDecoder(update);
          const dec = new Y.UpdateDecoderV2(decoder);
          const info = dec.readInfo();
          switch (binary.BITS5 & info) {
            case 0: {
              logger.warn("gc object");
            }
          }
          await postgresqlDb.storeUpdate(docName, update);
          if (persistedYdoc) {
            throttledFn(docName, postgresqlDb);
          }
        });
      } catch (err: any) {
        logger.error("process update failed", err);
      }
    },
    writeState: async (docName: string, ydoc: Y.Doc) => {},
  };
}