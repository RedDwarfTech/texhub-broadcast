import { SyncFileAttr } from "@/model/texhub/sync_file_attr.js";
import { pgHistoryDb } from "@/storage/feat/version/doc_history.js";
import _ from "lodash";
//@ts-ignore
import * as Y from "rdyjs";

const throttlePool = new Map<string, ReturnType<typeof _.throttle>>();

export const getThrottledFn = (docId: string) => {
  if (!throttlePool.has(docId)) {
    throttlePool.set(docId, _.throttle(
      async (syncFileAttr: SyncFileAttr, ydoc: Y.Doc) => {
        await pgHistoryDb.storeSnapshot(syncFileAttr, ydoc);
        throttlePool.delete(docId); 
      },
      60000,
      { leading: false, trailing: true }
    ));
  }
  return throttlePool.get(docId)!;
};