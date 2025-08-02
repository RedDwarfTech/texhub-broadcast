// @ts-ignore
import { getThrottledFn } from "@/common/app/throttle_util.js";
import logger from "@/common/log4js_config.js";
import { SyncFileAttr } from "@/model/texhub/sync_file_attr";
import { PgHisotoryPersistance } from "@/storage/adapter/postgresql/pg_history_persistance.js";
import * as Y from "rdyjs";

export const pgHistoryDb: PgHisotoryPersistance = new PgHisotoryPersistance();

export async function handleHistoryDoc(
  syncFileAttr: SyncFileAttr,
  ydoc: Y.Doc
) {
  try {
    const docIntId = syncFileAttr.docIntId!;
    const throttledSave =  getThrottledFn(docIntId)(syncFileAttr, ydoc);
    if (typeof throttledSave === 'function') {
      await throttledSave(syncFileAttr, ydoc);
    }
  } catch (error: any) {
    logger.error("save history doc error", error);
  }
}
