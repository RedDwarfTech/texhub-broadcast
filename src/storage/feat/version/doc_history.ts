// @ts-ignore
import { getThrottledFn } from "@/common/app/throttle_util.js";
import logger from "@/common/log4js_config.js";
import { SyncFileAttr } from "@/model/texhub/sync_file_attr";
import { PgHisotoryPersistance } from "@/storage/adapter/postgresql/pg_history_persistance.js";
import { throttledHistoryFn } from "@/storage/appfile.js";
import * as Y from "rdyjs";

export const pgHistoryDb: PgHisotoryPersistance = new PgHisotoryPersistance();

export async function handleHistoryDoc(
  syncFileAttr: SyncFileAttr,
  ydoc: Y.Doc
) {
  try {
    const docId = syncFileAttr.docIntId!;
    const throttledSave =  getThrottledFn(docId)(syncFileAttr, ydoc);
    await throttledSave(syncFileAttr, ydoc);
  } catch (error: any) {
    logger.error("save history doc error", error);
  }
}
