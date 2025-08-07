const persistenceDir = process.env.YPERSISTENCE;
// @ts-ignore
import * as Y from "rdyjs";
import { throttledFn } from "./appfile.js";
import { Persistence } from "../model/yjs/Persistence.js";
import { PostgresqlPersistance } from "./adapter/postgresql/postgresql_persistance.js";
import logger from "../common/log4js_config.js";
import { handleHistoryDoc } from "./feat/version/doc_history.js";
import { SyncFileAttr } from "@/model/texhub/sync_file_attr.js";
import { UpdateOrigin } from "@/model/yjs/net/update_origin.js";

export let persistencePostgresql: Persistence;

if (typeof persistenceDir === "string") {
  const postgresqlDb: PostgresqlPersistance = new PostgresqlPersistance();
  // postgresql
  persistencePostgresql = {
    provider: postgresqlDb,
    bindState: async (syncFileAttr: SyncFileAttr, ydoc: Y.Doc) => {
      try {
        const persistedYdoc: Y.Doc = await postgresqlDb.getYDoc(syncFileAttr);
        const newUpdates: Uint8Array = Y.encodeStateAsUpdate(ydoc);
        await postgresqlDb.storeUpdate(syncFileAttr, newUpdates);
        let uo: UpdateOrigin = {
          name: "persistencePostgresql",
          origin: "server",
        };
        Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(persistedYdoc),uo);

        // @ts-ignore
        ydoc.on("update", async (update: Uint8Array) => {
          await postgresqlDb.storeUpdate(syncFileAttr, update);
          if (persistedYdoc) {
            throttledFn(syncFileAttr, postgresqlDb);
          }
          handleHistoryDoc(syncFileAttr, ydoc);
        });

        // @ts-ignore
        ydoc.on("subdocs", (event: { added: Set<Y.Doc>, removed: Set<Y.Doc> }) => {
          event.added.forEach(subdoc => {
            // @ts-ignore
            subdoc.on("update", async (update: Uint8Array) => {
              logger.info("trigger subdoc update", subdoc);
              //await postgresqlDb.storeUpdate(syncFileAttr, update);
              //handleHistoryDoc(syncFileAttr, ydoc);
            });
          });
        });
      } catch (err: any) {
        logger.error("process update failed", err);
      }
    },
    writeState: async (docName: string, ydoc: Y.Doc) => {},
  };
}
