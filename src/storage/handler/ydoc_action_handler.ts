import { SyncFileAttr } from "@/model/texhub/sync_file_attr.js";
import { handleHistoryDoc } from "../feat/version/doc_history.js";
import { postgresqlDb } from "../storage.js";
import { throttledFn as throttledFlushToDiskAndSearchEngine } from "../appfile.js";
// @ts-ignore
import * as Y from "rdyjs";
import { detectFullDelete } from "./delete_detection.js";
import { recordFullDeletion } from "./deletion_audit.js";
import { UpdateOrigin } from "@/model/yjs/net/update_origin.js";
import logger from "@/common/log4js_config.js";

export const handleYDocUpdate = async (
  update: Uint8Array,
  ydoc: Y.Doc,
  syncFileAttr: SyncFileAttr,
  userContext?: Partial<UpdateOrigin>
) => {
  await preCheckBeforeFlush(syncFileAttr, update, ydoc, userContext);
};

export const preCheckBeforeFlush = async (
  syncFileAttr: SyncFileAttr,
  update: Uint8Array,
  ydoc: Y.Doc,
  userContext?: Partial<UpdateOrigin>
) => {
  try {
    // 检测是否为完全删除
    const detection = await detectFullDelete(update, ydoc, syncFileAttr);

    if (detection.isFullDelete) {
      // 记录完全删除的审计日志
      await recordFullDeletion({
        docName: syncFileAttr.docName,
        docId: syncFileAttr.docIntId,
        userId: userContext?.userId,
        userName: userContext?.userName,
        previousContentSize: detection.previousSize,
        timestamp: Date.now(),
        updateHash: syncFileAttr.hash
      });

      logger.warn(`[FULL_DELETE] Document completely deleted: doc=${syncFileAttr.docName}, previousSize=${detection.previousSize}, user=${userContext?.userId}`);
    }

    // 继续正常的处理流程
    await postgresqlDb.putUpdateToQueue(syncFileAttr, update);
    throttledFlushToDiskAndSearchEngine(syncFileAttr, postgresqlDb);
    handleHistoryDoc(syncFileAttr, ydoc);

  } catch (error) {
    logger.error("Failed to process YDoc update", error);
    throw error;
  }
};
