const persistenceDir = process.env.YPERSISTENCE;
// @ts-ignore
import * as Y from "yjs";
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
        await postgresqlDb.appendUpdateToWAL(syncFileAttr, newUpdates);
        let uo: UpdateOrigin = {
          name: "persistencePostgresql",
          origin: "server",
        };
        Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(persistedYdoc), uo);

        // @ts-ignore
        ydoc.on("update", async (update: Uint8Array, origin: UpdateOrigin) => {
          const updateHash = crypto
            .createHash("sha256")
            .update(update)
            .digest("hex");
          const updateTime = Date.now().toLocaleString();
          syncFileAttr.curTime = updateTime;
          syncFileAttr.hash = updateHash;

          // 传递用户上下文信息
          const userContext: Partial<UpdateOrigin> = {
            userId: origin?.userId,
            userName: origin?.userName,
            operationType: origin?.operationType || 'update'
          };

          handleYDocUpdate(update, ydoc, syncFileAttr, userContext);
        });
      } catch (err: any) {
        logger.error("process update failed", err);
      }
    },
    /**
     * 文档销毁前的收尾（P0：R2 修复）。
     *
     * 至少保证该文档的 WAL 已消费排空（pending 全部写入 tex_sync），
     * 再对当前内存状态做一次 compact 落库，避免"队列未排空即销毁文档"。
     */
    writeState: async (docName: string, ydoc: Y.Doc) => {
      try {
        const { waitDocWALDrained } = await import(
          "@/storage/wal/wal_update_handler.js"
        );
        const drained = await waitDocWALDrained(docName, 30000);
        if (!drained) {
          logger.warn(
            `[writeState] WAL drain timeout for ${docName}, proceed with compact write`
          );
        }
        // 将当前内存 Y.Doc 状态以 compact update 形式写回，降低全量重建成本
        const stateAsUpdate = Y.encodeStateAsUpdate(ydoc);
        const stateVector = Y.encodeStateVector(ydoc);
        const syncFileAttr: SyncFileAttr = {
          docName,
          docType: 1,
          projectId: "",
          docIntId: "",
          docShowName: "writeState",
          src: "writeState",
        };
        if (postgresqlDb.pool) {
          const { flushDocument: flushDocumentOp } = await import(
            "./adapter/postgresql/postgresql_operation.js"
          );
          await flushDocumentOp(
            postgresqlDb.pool,
            syncFileAttr,
            stateAsUpdate,
            stateVector
          );
        } else {
          logger.warn(`[writeState] pool not ready, skip compact write for ${docName}`);
        }
      } catch (err: any) {
        logger.error(`[writeState] failed for ${docName}`, err);
      }
    },
  };
}
