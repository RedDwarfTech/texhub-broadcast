// @ts-ignore
import { getHistoryDocsThrottledFn, recordHistoryDocSnapshot, markHistoryPending } from "@/common/app/throttle_util.js";
import logger from "@/common/log4js_config.js";
import { SyncFileAttr } from "@/model/texhub/sync_file_attr";
import { PgHisotoryPersistance } from "@/storage/adapter/postgresql/pg_history_persistance.js";
import * as Y from "yjs";

export const pgHistoryDb: PgHisotoryPersistance = new PgHisotoryPersistance();

export async function handleHistoryDoc(
  syncFileAttr: SyncFileAttr,
  ydoc: Y.Doc
) {
  try {
    const docIntId = syncFileAttr.docIntId!;
    if (!docIntId) {
      logger.error("[history] skip snapshot, docIntId is empty", {
        docName: syncFileAttr.docName,
        projectId: syncFileAttr.projectId,
      });
      return;
    }
    const throttledSave = getHistoryDocsThrottledFn(docIntId);
    if (typeof throttledSave === 'function') {
      recordHistoryDocSnapshot(syncFileAttr, ydoc);
      await markHistoryPending(syncFileAttr.projectId, docIntId, syncFileAttr.docName);
      logger.info("[history] queued snapshot", {
        docIntId,
        docName: syncFileAttr.docName,
        projectId: syncFileAttr.projectId,
        time: new Date().toISOString(),
      });
      await throttledSave(syncFileAttr, ydoc);
    }
  } catch (error: any) {
    logger.error("save history doc error", error);
  }
}
