// @ts-ignore
import { PgHisotoryPersistance } from "@/storage/adapter/postgresql/pg_history_persistance";
import * as Y from "rdyjs";

const pgHistoryDb: PgHisotoryPersistance = new PgHisotoryPersistance();

export async function handleHistoryDoc(docName: string) {
  // handle history doc
  // this history may be low frequency update compare with the online doc
  // so we store the history seperate with the online doc
  const historyDoc: Y.Doc = await pgHistoryDb.getHisotyYDoc(docName + "_history");
  const historyUpdates: Uint8Array = Y.encodeStateAsUpdate(historyDoc);
  await pgHistoryDb.storeUpdate(docName + "_history", historyUpdates);
  const DEFAULT_HISTORY_INTERVAL = 5000;
  // @ts-ignore
  historyDoc.on("update", async (update: Uint8Array) => {
    await pgHistoryDb.storeUpdate(docName + "_history", update);
  });
}
