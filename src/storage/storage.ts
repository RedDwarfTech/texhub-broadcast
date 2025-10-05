const persistenceDir = process.env.YPERSISTENCE;
// @ts-ignore
import * as Y from "rdyjs";
import { Persistence } from "../model/yjs/Persistence.js";
import { PostgresqlPersistance } from "./adapter/postgresql/postgresql_persistance.js";
import logger from "../common/log4js_config.js";
import { SyncFileAttr } from "@/model/texhub/sync_file_attr.js";
import { UpdateOrigin } from "@/model/yjs/net/update_origin.js";
import { handleYDocUpdate } from "./handler/ydoc_action_handler.js";
import crypto from "crypto";

export let persistencePostgresql: Persistence;
export const postgresqlDb: PostgresqlPersistance = new PostgresqlPersistance();

if (typeof persistenceDir === "string") {
  // postgresql
  persistencePostgresql = {
    provider: postgresqlDb,
    bindState: async (syncFileAttr: SyncFileAttr, ydoc: Y.Doc) => {
      try {
        const persistedYdoc: Y.Doc = await postgresqlDb.getYDoc(syncFileAttr);
        const newUpdates: Uint8Array = Y.encodeStateAsUpdate(ydoc);
        const updateHash = crypto
          .createHash("sha256")
          .update(newUpdates)
          .digest("hex");
        const updateTime = Date.now().toLocaleString();
        syncFileAttr.curTime = updateTime;
        syncFileAttr.hash = updateHash;
        await postgresqlDb.putUpdateToQueue(syncFileAttr, newUpdates);
        let uo: UpdateOrigin = {
          name: "persistencePostgresql",
          origin: "server",
        };
        Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(persistedYdoc), uo);

        // @ts-ignore
        ydoc.on("update", async (update: Uint8Array) => {
          const updateHash = crypto
            .createHash("sha256")
            .update(newUpdates)
            .digest("hex");
          const updateTime = Date.now().toLocaleString();
          syncFileAttr.curTime = updateTime;
          syncFileAttr.hash = updateHash;
          handleYDocUpdate(update, ydoc, syncFileAttr);
        });
      } catch (err: any) {
        logger.error("process update failed", err);
      }
    },
    writeState: async (docName: string, ydoc: Y.Doc) => {},
  };
}
