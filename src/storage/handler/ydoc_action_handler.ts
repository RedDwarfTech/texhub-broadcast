import { SyncFileAttr } from "@/model/texhub/sync_file_attr.js";
import { handleHistoryDoc } from "../feat/version/doc_history.js";
import { postgresqlDb } from "../storage.js";
import { throttledFn } from "../appfile.js";
// @ts-ignore
import * as Y from "rdyjs";
import logger from "@/common/log4js_config.js";

export const handleYDocUpdate = async (
  update: Uint8Array,
  ydoc: Y.Doc,
  syncFileAttr: SyncFileAttr,
  persistedYdoc: Y.Doc,
  isSubdoc: boolean = false
) => {
  preCheckBeforeFlush(syncFileAttr, update, ydoc, persistedYdoc, isSubdoc);
};

export const preCheckBeforeFlush = async (
  syncFileAttr: SyncFileAttr,
  update: Uint8Array,
  ydoc: Y.Doc,
  persistedYdoc: Y.Doc,
  isSubdoc: boolean = false
) => {
  Y.applyUpdate(persistedYdoc, update);
  let dbSubdocText = persistedYdoc.getText(syncFileAttr.docName);
  let dbSubdocTextStr = dbSubdocText.toString();
  if (dbSubdocTextStr === "" && isSubdoc) {
    /**
     * empty content, do not store
     * when we introduce the subdocument, the document will be cleared unexpectedly
     * so we check if the document turn to blank
     * just log a warning here and skip the store operation
     * we can find out the reason and fix it later
     */
    logger.warn(
      `dbSubdocTextStr is empty, docName=${syncFileAttr.docName}, syncFileAttr=` +
        JSON.stringify(syncFileAttr)
    );
    return;
  }
  await postgresqlDb.storeUpdate(syncFileAttr, update);
  if (persistedYdoc) {
    throttledFn(syncFileAttr, postgresqlDb);
  }
  handleHistoryDoc(syncFileAttr, ydoc);
};
