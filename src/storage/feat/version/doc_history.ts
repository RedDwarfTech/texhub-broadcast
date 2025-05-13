// @ts-ignore
import logger from "@/common/log4js_config.js";
import { PgHisotoryPersistance } from "@/storage/adapter/postgresql/pg_history_persistance.js";
import { throttledHistoryFn } from "@/storage/appfile.js";
import * as Y from "rdyjs";

export const pgHistoryDb: PgHisotoryPersistance = new PgHisotoryPersistance();

export async function handleHistoryDoc(
  docName: string,
  ydoc: Y.Doc,
  historyDoc: Y.Doc
) {
  try {
    throttledHistoryFn(docName, historyDoc, ydoc);
  } catch (error: any) {
    logger.error("save history doc error", error);
  }
}
