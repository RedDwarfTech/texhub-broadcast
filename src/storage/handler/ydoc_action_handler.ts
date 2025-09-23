import { SyncFileAttr } from "@/model/texhub/sync_file_attr.js";
import { handleHistoryDoc } from "../feat/version/doc_history.js";
import { postgresqlDb } from "../storage.js";
import { throttledFn as throttledFlushToDiskAndSearchEngine } from "../appfile.js";
// @ts-ignore
import * as Y from "rdyjs";

export const handleYDocUpdate = async (
  update: Uint8Array,
  ydoc: Y.Doc,
  syncFileAttr: SyncFileAttr
) => {
  preCheckBeforeFlush(syncFileAttr, update, ydoc);
};

export const preCheckBeforeFlush = async (
  syncFileAttr: SyncFileAttr,
  update: Uint8Array,
  ydoc: Y.Doc
) => {
  await postgresqlDb.putUpdateToQueue(syncFileAttr, update);
  throttledFlushToDiskAndSearchEngine(syncFileAttr, postgresqlDb);
  handleHistoryDoc(syncFileAttr, ydoc);
};
