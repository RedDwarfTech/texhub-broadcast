import { SyncFileAttr } from "@/model/texhub/sync_file_attr.js";
import { handleHistoryDoc } from "../feat/version/doc_history.js";
import { postgresqlDb } from "../storage.js";
import { throttledFn as throttledFlushToDiskAndSearchEngine } from "../appfile.js";
// @ts-ignore
import * as Y from "yjs";
import { detectFullDelete } from "./delete_detection.js";
import { recordFullDeletion } from "./deletion_audit.js";
import { UpdateOrigin } from "@/model/yjs/net/update_origin.js";
import logger from "@/common/log4js_config.js";
import { markDiskFlushPending, markDiskFlushPendingRedis } from "@/common/app/throttle_util.js";
import { TeXFileType } from "@model/enum/tex_file_type.js";
// @ts-ignore
import * as decoding from "lib0/decoding";
// @ts-ignore
import * as syncProtocol from "y-protocols/sync";

type YDocUpdateTracker = {
  doc: Y.Doc;
  observed: boolean;
  active: boolean;
  promise: Promise<boolean>;
  resolve: (value: boolean) => void;
};

const pendingYDocUpdates = new WeakMap<object, Set<YDocUpdateTracker>>();

const getOriginKey = (origin: any): object | null => {
  if (
    (typeof origin === "object" && origin !== null) ||
    typeof origin === "function"
  ) {
    return origin as object;
  }
  return null;
};

const removeTracker = (
  origin: any,
  tracker: YDocUpdateTracker
): void => {
  const key = getOriginKey(origin);
  if (!key) return;
  const trackers = pendingYDocUpdates.get(key);
  if (!trackers) return;
  trackers.delete(tracker);
  if (trackers.size === 0) pendingYDocUpdates.delete(key);
};

export const beginYDocUpdateTracking = (
  origin: any,
  doc: Y.Doc
): YDocUpdateTracker | null => {
  const key = getOriginKey(origin);
  if (!key) return null;
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((done) => {
    resolve = done;
  });
  const tracker: YDocUpdateTracker = {
    doc,
    observed: false,
    active: true,
    promise,
    resolve,
  };
  let trackers = pendingYDocUpdates.get(key);
  if (!trackers) {
    trackers = new Set<YDocUpdateTracker>();
    pendingYDocUpdates.set(key, trackers);
  }
  trackers.add(tracker);
  return tracker;
};

export const observeYDocUpdate = (origin: any, doc: Y.Doc): void => {
  const key = getOriginKey(origin);
  const trackers = key ? pendingYDocUpdates.get(key) : undefined;
  if (!trackers) return;
  for (const tracker of trackers) {
    if (tracker.active && tracker.doc === doc && !tracker.observed) {
      tracker.observed = true;
      return;
    }
  }
};

export const completeYDocUpdate = (
  origin: any,
  doc: Y.Doc,
  persisted: boolean
): void => {
  const key = getOriginKey(origin);
  const trackers = key ? pendingYDocUpdates.get(key) : undefined;
  if (!trackers) return;
  for (const tracker of trackers) {
    if (tracker.active && tracker.doc === doc && tracker.observed) {
      tracker.active = false;
      removeTracker(origin, tracker);
      tracker.resolve(persisted);
      return;
    }
  }
};

export const cancelYDocUpdateTracking = (
  origin: any,
  tracker: YDocUpdateTracker | null
): void => {
  if (!tracker || !tracker.active) return;
  tracker.active = false;
  removeTracker(origin, tracker);
  tracker.resolve(true);
};

export const readYjsUpdatePayload = (decoder: any): Uint8Array | null => {
  try {
    const copy = decoding.clone(decoder);
    if (decoding.readVarUint(copy) !== syncProtocol.messageYjsUpdate) {
      return null;
    }
    return decoding.readVarUint8Array(copy);
  } catch (e) {
    return null;
  }
};

export const handleYDocUpdate = async (
  update: Uint8Array,
  ydoc: Y.Doc,
  syncFileAttr: SyncFileAttr,
  userContext?: Partial<UpdateOrigin>
): Promise<boolean> => {
  return preCheckBeforeFlush(syncFileAttr, update, ydoc, userContext);
};

export const preCheckBeforeFlush = async (
  syncFileAttr: SyncFileAttr,
  update: Uint8Array,
  ydoc: Y.Doc,
  userContext?: Partial<UpdateOrigin>
): Promise<boolean> => {
  try {
    const detection = await detectFullDelete(update, ydoc, syncFileAttr);

    if (detection.isFullDelete) {
      const ydocTextLen =
        ydoc.getText(syncFileAttr.docName)?.toString()?.length ?? 0;

      await recordFullDeletion({
        docName: syncFileAttr.docName,
        docId: syncFileAttr.docIntId,
        userId: userContext?.userId,
        userName: userContext?.userName,
        previousContentSize: detection.previousSize,
        timestamp: Date.now(),
        updateHash: syncFileAttr.hash,
      });

      logger.warn("[FULL_DELETE] Document completely deleted", {
        docName: syncFileAttr.docName,
        docIntId: syncFileAttr.docIntId,
        docShowName: syncFileAttr.docShowName,
        projectId: syncFileAttr.projectId,
        previousSize: detection.previousSize,
        currentSize: detection.currentSize,
        ydocTextLen,
        updateByteLength: detection.updateByteLength,
        updateHash: syncFileAttr.hash,
        syncSrc: syncFileAttr.src,
        traceId: detection.traceId,
        msgSrc: syncFileAttr.msgBody?.src,
        msgType: syncFileAttr.msgBody?.msg_type,
        userId: userContext?.userId,
        userName: userContext?.userName,
        operationType: userContext?.operationType,
        origin: userContext?.origin,
        reason: userContext?.reason,
        sessionId: userContext?.sessionId,
        clientInfo: userContext?.clientInfo,
      });
    }

    const persisted = await postgresqlDb.appendUpdateToWAL(syncFileAttr, update);
    if (!persisted && syncFileAttr.docType !== TeXFileType.PROJECT) {
      logger.error("Failed to persist YDoc update", {
        docName: syncFileAttr.docName,
        src: syncFileAttr.src,
      });
      return false;
    }

    try {
      throttledFlushToDiskAndSearchEngine(syncFileAttr, postgresqlDb);
      handleHistoryDoc(syncFileAttr, ydoc);
      const fileId = syncFileAttr.docIntId || syncFileAttr.docName;
      markDiskFlushPending(syncFileAttr, ydoc);
      markDiskFlushPendingRedis(
        syncFileAttr.projectId,
        fileId,
        syncFileAttr.docName
      );
    } catch (error) {
      logger.error("Failed to process post-persistence YDoc tasks", error);
    }
    return true;
  } catch (error) {
    logger.error("Failed to process YDoc update", error);
    return false;
  }
};
