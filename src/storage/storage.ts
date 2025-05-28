const persistenceDir = process.env.YPERSISTENCE;
// @ts-ignore
import * as Y from "rdyjs";
import { throttledFn } from "./appfile.js";
import { Persistence } from "../model/yjs/Persistence.js";
import { PostgresqlPersistance } from "./adapter/postgresql/postgresql_persistance.js";
import logger from "../common/log4js_config.js";
import { handleHistoryDoc, pgHistoryDb } from "./feat/version/doc_history.js";
import { SyncFileAttr } from "@/model/texhub/sync_file_attr.js";

export let persistencePostgresql: Persistence;

if (typeof persistenceDir === "string") {
  const postgresqlDb: PostgresqlPersistance = new PostgresqlPersistance();
  // postgresql
  persistencePostgresql = {
    provider: postgresqlDb,
    bindState: async (syncFileAttr: SyncFileAttr, ydoc: Y.Doc) => {
      try {
        let docName = syncFileAttr.docName;
        const persistedYdoc: Y.Doc = await postgresqlDb.getYDoc(docName);
        const newUpdates: Uint8Array = Y.encodeStateAsUpdate(ydoc);
        await postgresqlDb.storeUpdate(docName, newUpdates);
        Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(persistedYdoc));

        // handle history doc
        // this history may be low frequency update compare with the online doc
        // so we store the history seperate with the online doc
        const historyDoc: Y.Doc = await pgHistoryDb.getHisotyYDoc(
          docName + "_history"
        );
        // @ts-ignore
        ydoc.on("update", async (update: Uint8Array) => {
          await postgresqlDb.storeUpdate(docName, update);
          if (persistedYdoc) {
            throttledFn(syncFileAttr, postgresqlDb);
          }
          handleHistoryDoc(syncFileAttr, ydoc, historyDoc);
        });
      } catch (err: any) {
        logger.error("process update failed", err);
      }
    },
    writeState: async (docName: string, ydoc: Y.Doc) => {},
  };
}
