import { SyncFileAttr } from "@/model/texhub/sync_file_attr.js";
import { pgHistoryDb } from "@/storage/feat/version/doc_history.js";
import _ from "lodash";
//@ts-ignore
import * as Y from "rdyjs";

const historyDocsThrottlePool = new Map<string, ReturnType<typeof _.throttle>>();

export const getHistoryDocsThrottledFn = (docIntId: string) => {
  if (!historyDocsThrottlePool.has(docIntId)) {
    historyDocsThrottlePool.set(docIntId, _.throttle(
      async (syncFileAttr: SyncFileAttr, ydoc: Y.Doc) => {
        await pgHistoryDb.storeHistorySnapshot(syncFileAttr, ydoc);
        historyDocsThrottlePool.delete(docIntId); 
      },
      60000,
      { leading: false, trailing: true }
    ));
  }
  return historyDocsThrottlePool.get(docIntId)!;
};