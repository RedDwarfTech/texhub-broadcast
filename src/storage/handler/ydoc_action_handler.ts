import { SyncFileAttr } from "@/model/texhub/sync_file_attr.js";
import { handleHistoryDoc } from "../feat/version/doc_history.js";
import { postgresqlDb } from "../storage.js";
import { throttledFn } from "../appfile.js";
// @ts-ignore
import * as Y from "rdyjs";

export const handleYDocUpdate = async (
  update: Uint8Array,
  ydoc: Y.Doc,
  syncFileAttr: SyncFileAttr,
  persistedYdoc: Y.Doc
) => {
  preCheckBeforeFlush(syncFileAttr, update, ydoc, persistedYdoc);
};

export const preCheckBeforeFlush = async (
  syncFileAttr: SyncFileAttr,
  update: Uint8Array,
  ydoc: Y.Doc,
  persistedYdoc: Y.Doc
) => {
  await postgresqlDb.putUpdateToQueue(syncFileAttr, update);
  if (persistedYdoc) {
    throttledFn(syncFileAttr, postgresqlDb);
  }
  handleHistoryDoc(syncFileAttr, ydoc);
};
