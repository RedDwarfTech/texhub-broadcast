// @ts-ignore
import logger from "@/common/log4js_config.js";
import { PgHisotoryPersistance } from "@/storage/adapter/postgresql/pg_history_persistance.js";
import { throttledHistoryFn } from "@/storage/appfile.js";
import * as Y from "rdyjs";

const pgHistoryDb: PgHisotoryPersistance = new PgHisotoryPersistance();

export async function handleHistoryDoc(docName: string) {
  try {
    // handle history doc
    // this history may be low frequency update compare with the online doc
    // so we store the history seperate with the online doc
    const historyDoc: Y.Doc = await pgHistoryDb.getHisotyYDoc(
      docName + "_history"
    );
    const historyUpdates: Uint8Array = Y.encodeStateAsUpdate(historyDoc);
    await pgHistoryDb.storeUpdate(docName + "_history", historyUpdates);
    const DEFAULT_HISTORY_INTERVAL = 5000;
    // @ts-ignore
    historyDoc.on("update", async (update: Uint8Array) => {
      throttledHistoryFn(docName, pgHistoryDb, update);
    });
  } catch (error: any) {
    logger.error("save history doc error", error);
  }
}
