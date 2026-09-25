import { Socket } from "socket.io";
import { WSSharedDoc } from "@collar/ws_share_doc.js";
// @ts-ignore
import * as encoding from "lib0/encoding";
// @ts-ignore
import * as Y from "yjs";
// @ts-ignore
import * as decoding from "lib0/decoding";
import logger from "@common/log4js_config.js";
import { getYDoc, docs } from "@collar/yjs_utils.js";
import { SyncMessageType } from "@model/texhub/sync_msg_type.js";
import { send } from "../../action/ws_action.js";
// @ts-ignore
import * as syncProtocol from "y-protocols/sync";
import { SyncFileAttr } from "@/model/texhub/sync_file_attr.js";
import { getTexFileInfo } from "@/storage/appfile.js";
import { FileContent } from "@/model/texhub/file_content.js";
import { SyncMessageContext } from "@/model/texhub/sync_msg_context.js";
import {
  handleYDocUpdate,
  beginYDocUpdateTracking,
  cancelYDocUpdateTracking,
  readYjsUpdatePayload,
} from "@/storage/handler/ydoc_action_handler.js";
import { persistencePostgresql } from "@/storage/storage.js";
import { DocMeta } from "@/model/yjs/commom/doc_meta.js";
import { v4 as uuidv4 } from "uuid";
import { RdJsonUtil } from "rdjs-wheel";
import * as crypto from "crypto";
import { Buffer } from "buffer";
import {
  serverSendSyncStep1,
  serverWriteUpdate,
  writeSyncStep2,
} from "./server_protocol_action.js";
import { emitSyncAck, emitSyncNack } from "../../action/ws_action.js";
import {
  joinDocRoom,
  toDocRoom,
} from "@/common/sync/room_broadcast.js";

let cryptoModule: any | null = null;

/**
 * relationship of main doc & sub docs
 * @type {Map<String, Map<String, WSSharedDoc>>} mainDocID, subDocID
 */
const subdocsMap: Map<String, Map<String, WSSharedDoc>> = new Map();

/**
 * Remove every subdoc entry for a rootDoc from the in-memory map.
 * Must be called whenever a rootDoc is evicted from the docs cache, otherwise
 * stale entries keep pointing to destroyed instances and the update handler
 * keeps broadcasting to the destroyed rootDoc's (empty) conn set.
 *
 * @param rootDocName
 */
export const clearSubdocsForRootDoc = (rootDocName: string) => {
  const subdocs = subdocsMap.get(rootDocName);
  const removed = subdocsMap.delete(rootDocName);
  if (subdocs) {
    for (const [subdocId, subdoc] of subdocs) {
      const key = String(subdocId);
      const hasOtherProjectOwner = Array.from(subdocsMap.entries()).some(
        ([rootName, map]) =>
          rootName !== rootDocName && map.get(String(subdocId)) === subdoc
      );
      if (
        docs.get(key) === subdoc &&
        !hasOtherProjectOwner &&
        subdoc.conns.size === 0
      ) {
        docs.delete(key);
        subdoc.destroy();
      }
    }
  }
  if (removed) {
    logger.info(`[subdocsMap] cleared for rootDoc ${rootDocName}`);
  }
  return removed;
};

/**
 * Create an update handler for a subdocument using a snapshot of context.
 * Kept as a factory to keep handleSubDocFirstTimePut small and testable.
 */
function createSubdocUpdateHandler(
  curSubDoc: WSSharedDoc,
  conn: Socket,
  rootDoc: WSSharedDoc,
  snapshotSyncFileAttr: SyncFileAttr,
  snapshotSubdocGuid: string
) {
  const handler = async (update: Uint8Array, origin: Socket) => {
    try {
      // log minimal diagnostic info
      try {
        const updateHash = crypto.createHash("md5").update(update).digest("hex");
        logger.info("[subdoc_update_handler] fired", {
          subdocGuid: snapshotSubdocGuid,
          curDocGuid: (curSubDoc as any).guid || (curSubDoc as any).name || "unknown",
          rootDoc: rootDoc.name,
          connId: conn.id,
          originId: origin && (origin as any).id ? (origin as any).id : String(origin),
          updateHash,
          updateLen: update ? update.length : 0,
          syncFileAttr: snapshotSyncFileAttr,
          time: new Date().toISOString(),
        });
      } catch (e) {
        // swallow logging errors
      }

      if (snapshotSubdocGuid === rootDoc.name) {
        logger.warn(
          `the subdocGuid equal to rootDoc.name,syncFileAttr:${JSON.stringify(snapshotSyncFileAttr)}`
        );
      }

      const deepCopied = structuredClone(snapshotSyncFileAttr);
      deepCopied.src = deepCopied.src + "_subdoc_update";

      await handleSubDocUpdate(update, origin, curSubDoc, snapshotSubdocGuid, deepCopied, rootDoc);
    } catch (err) {
      logger.error("error in subdoc update handler", err);
    }
  };

  return handler;
}

/**
 * hand the subdocument message
 * https://discuss.yjs.dev/t/extend-y-websocket-provider-to-support-sub-docs-synchronization-in-one-websocket-connection/1294
 *
 * @param rootDoc
 * @param conn
 * @param message
 */
export const handleSubDocMsg = async (
  rootDoc: WSSharedDoc,
  conn: Socket,
  decoder: any
) => {
  await preHandleSubDoc(decoder, conn, rootDoc);
};

const preHandleSubDoc = async (
  decoder: any,
  conn: Socket,
  rootDoc: WSSharedDoc
) => {
  let ackDoc = "";
  let ackSeq: number | undefined;
  try {
    const encoder = encoding.createEncoder();
    const context = decoding.readVarString(decoder);
    const isJson = RdJsonUtil.hasJsonStructure(context);
    const docContext = isJson ? JSON.parse(context) : context;
    const subdocGuid = isJson ? docContext.doc_name : docContext;
    ackDoc = subdocGuid;
    if (docContext && typeof docContext === "object") {
      ackSeq = typeof docContext.seq === "number" ? docContext.seq : undefined;
    }
    let docIntId = "";
    let fileInfo: FileContent = {
      id: "",
      project_id: "",
      name: "",
      file_path: "",
      project_created_time: "",
      created_time: "",
      updated_time: "",
      file_id: "",
    };
    if (subdocGuid !== rootDoc.name) {
      fileInfo = await getTexFileInfo(subdocGuid);
      if (fileInfo) {
        docIntId = fileInfo.id;
      }
    }
    let syncFileAttr: SyncFileAttr = {
      docName: subdocGuid,
      projectId: rootDoc.name,
      docIntId: docIntId,
      docShowName: fileInfo.name,
      docType: 1,
      src: "preHandleSubDoc",
      msgBody: docContext,
    };
    const curSubDoc = await getYDoc(syncFileAttr);
    curSubDoc.__isSubdoc = subdocGuid !== rootDoc.name;
    // P1（docs/design/message-reliable.md §6.1）：连接首次接触某子文档即加入其

    // room，后续该子文档的 update/awareness 广播（含跨实例 Redis Adapter 转发）
    // 才能覆盖到本连接。
    joinDocRoom(conn, toDocRoom(subdocGuid));
    const syncDocs = (conn as any).__syncDocs as Set<string> | undefined;
    if (syncDocs) {
      syncDocs.add(String(subdocGuid));
    }
    const applied = await handleSubDoc(
      curSubDoc,
      conn,
      rootDoc,
      syncFileAttr,
      decoder,
      encoder
    );
    if (applied && ackSeq !== undefined) {
      emitSyncAck(conn, ackDoc, ackSeq);
    } else if (ackSeq !== undefined) {
      emitSyncNack(conn, ackDoc, ackSeq, "apply_failed");
    }
  } catch (err) {
    if (ackSeq !== undefined) {
      emitSyncNack(conn, ackDoc, ackSeq, "server_error");
    }
    logger.error("handle sub doc facing issue:" + rootDoc.name, err);
  }
};

const handleNormalMsg = async (
  rootDoc: WSSharedDoc,
  conn: Socket,
  decoder: any,
  encoder: any,
  curSubDoc: WSSharedDoc,
  syncFileAttr: SyncFileAttr
): Promise<boolean> => {
  const subdocGuid = syncFileAttr.docName;
  const curSubdocMap: Map<String, WSSharedDoc> | undefined = subdocsMap.get(
    rootDoc.name
  );
  if (!curSubdocMap || !curSubdocMap.has(subdocGuid)) {
    return false;
  }

  const targetDoc = subdocGuid === rootDoc.name ? rootDoc : curSubDoc;
  const tracker = persistencePostgresql
    ? beginYDocUpdateTracking(conn, targetDoc)
    : null;
  try {
    const cachedSubDoc = curSubdocMap.get(subdocGuid);
    ensureSubdocUpdateHandler(curSubDoc, conn, rootDoc, syncFileAttr);
    if (cachedSubDoc !== curSubDoc) {
      curSubdocMap.set(subdocGuid, curSubDoc);
    }
    if (!decoding.hasContent(decoder)) {
      cancelYDocUpdateTracking(conn, tracker);
      return false;
    }

    const updatePayload = readYjsUpdatePayload(decoder);
    encoding.writeVarUint(encoder, SyncMessageType.SubDocMessageSync);
    const uniqueValue = uuidv4();
    const msg: SyncMessageContext = {
      doc_name: subdocGuid,
      src: "handleNormalMsg",
      trace_id: uniqueValue,
    };
    encoding.writeVarString(encoder, JSON.stringify(msg));

    let syncError: Error | null = null;
    const syncMsgType = syncProtocol.readSyncMessage(
      decoder,
      encoder,
      targetDoc,
      conn,
      (error: Error) => {
        syncError = error;
      }
    );
    if (encoding.length(encoder) > 1 && needSend(encoder)) {
      await send(targetDoc, conn, encoding.toUint8Array(encoder), syncFileAttr);
    }
    if (
      syncMsgType !== syncProtocol.messageYjsUpdate ||
      syncError !== null
    ) {
      cancelYDocUpdateTracking(conn, tracker);
      return false;
    }
    if (!persistencePostgresql) {
      return true;
    }
    if (tracker?.observed) {
      return await tracker.promise;
    }
    cancelYDocUpdateTracking(conn, tracker);
    if (!updatePayload) {
      return false;
    }
    return await handleYDocUpdate(updatePayload, targetDoc, syncFileAttr);
  } catch (e) {
    cancelYDocUpdateTracking(conn, tracker);
    logger.error("write sub document sync failed, docGuid:" + subdocGuid, e);
    return false;
  }
};

const handleSubDocUpdate = async (
  update: Uint8Array,
  origin: any,
  curSubDoc: WSSharedDoc,
  subdocGuid: string,
  syncFileAttr: SyncFileAttr,
  rootDoc: WSSharedDoc
) => {
  serverWriteUpdate(update, subdocGuid, rootDoc, origin as Socket);
};

/**
 * Register (or re-register) the subdoc update handler on the given doc instance.
 *
 * Idempotent per (curSubDoc, rootDoc) pair. The previous handler captured the
 * rootDoc via closure; if that rootDoc has been destroyed and recreated (the
 * docs cache evicts rootDocs when the last conn closes), the old handler would
 * broadcast to an empty conn set and all downstream sync silently breaks.
 * This re-binds the handler whenever the bound rootDoc differs.
 *
 * @param curSubDoc
 * @param conn
 * @param rootDoc
 * @param syncFileAttr
 */
function ensureSubdocUpdateHandler(
  curSubDoc: WSSharedDoc,
  conn: Socket,
  rootDoc: WSSharedDoc,
  syncFileAttr: SyncFileAttr
): void {
  const subdocGuid = syncFileAttr.docName;
  if (subdocGuid === rootDoc.name) {
    return;
  }
  // @ts-ignore
  const existingHandler = (curSubDoc as any).__subdocUpdateHandler;
  // @ts-ignore
  const boundRootDoc: WSSharedDoc | undefined = (curSubDoc as any).__subdocHandlerRootDoc;
  if (existingHandler && boundRootDoc === rootDoc) {
    return;
  }
  if (existingHandler && typeof curSubDoc.off === "function") {
    // @ts-ignore
    curSubDoc.off("update", existingHandler);
  }
  const snapshotSyncFileAttr = structuredClone(syncFileAttr);
  const snapshotSubdocGuid = String(subdocGuid);
  const handler = createSubdocUpdateHandler(
    curSubDoc,
    conn,
    rootDoc,
    snapshotSyncFileAttr,
    snapshotSubdocGuid
  );
  // @ts-ignore
  (curSubDoc as any).__subdocUpdateHandler = handler;
  // @ts-ignore
  (curSubDoc as any).__subdocHandlerRootDoc = rootDoc;
  curSubDoc.on("update", handler);
  logger.info("[subdoc_update_handler] registered", {
    subdocGuid,
    rootDoc: rootDoc.name,
    connId: conn.id,
    time: new Date().toISOString(),
  });
}

const handleSubDoc = async (
  curSubDoc: WSSharedDoc,
  conn: Socket,
  rootDoc: WSSharedDoc,
  syncFileAttr: SyncFileAttr,
  decoder: any,
  encoder: any
): Promise<boolean> => {
  const subdocGuid = syncFileAttr.docName;
  if (!rootDoc.conns.has(conn)) {
    rootDoc.conns.set(conn, new Set());
  }
  const curSubdocMap: Map<String, WSSharedDoc> | undefined = subdocsMap.get(
    rootDoc.name
  );
  const isSyncStep1 = Boolean(
    syncFileAttr.msgBody && syncFileAttr.msgBody.msg_type === "sync_step_1"
  );
  if (isSyncStep1) {
    writeSyncStep2(curSubDoc, conn, syncFileAttr);
  }
  if (curSubdocMap && curSubdocMap.has(subdocGuid)) {
    return isSyncStep1
      ? true
      : await handleNormalMsg(
          rootDoc,
          conn,
          decoder,
          encoder,
          curSubDoc,
          syncFileAttr
        );
  }
  const registered = await handleSubDocFirstTimePut(
    curSubdocMap,
    subdocGuid,
    curSubDoc,
    rootDoc,
    conn,
    syncFileAttr
  );
  if (!registered || isSyncStep1) {
    return registered;
  }
  return await handleNormalMsg(
    rootDoc,
    conn,
    decoder,
    encoder,
    curSubDoc,
    syncFileAttr
  );
};

const handleSubDocFirstTimePut = async (
  curSubdocMap: Map<String, WSSharedDoc> | undefined,
  subdocGuid: string,
  curSubDoc: WSSharedDoc,
  rootDoc: WSSharedDoc,
  conn: Socket,
  syncFileAttr: SyncFileAttr
): Promise<boolean> => {
  try {
    ensureSubdocUpdateHandler(curSubDoc, conn, rootDoc, syncFileAttr);
    const subDocText = curSubDoc.getText(subdocGuid);
    subDocText.observe(() => undefined);
    const docMeta: DocMeta = {
      name: subdocGuid,
      id: syncFileAttr.docIntId!,
      src: "server",
    };
    if (curSubdocMap) {
      curSubDoc.meta = docMeta;
      subdocsMap.get(rootDoc.name)!.set(subdocGuid, curSubDoc);
    } else {
      const newMap = new Map<String, WSSharedDoc>();
      curSubDoc.meta = docMeta;
      newMap.set(subdocGuid, curSubDoc);
      subdocsMap.set(rootDoc.name, newMap);
    }
    return true;
  } catch (e) {
    logger.error("handle first time put failed, docGuid:" + subdocGuid, e);
    return false;
  }
};

/**
 * if the document only contains message type and document guid
 * skip and not send this invalid message
 *
 * @param {encoding.Encoder} encoder
 */
const needSend = (encoder: any) => {
  try {
    const buf = encoding.toUint8Array(encoder);
    const decoder = decoding.createDecoder(buf);
    if (!decoding.hasContent(decoder)) {
      logger.warn("the origin did not has content");
      return false;
    }
    decoding.readVarUint(decoder);
    if (!decoding.hasContent(decoder)) {
      logger.warn("the origin read msg type did not has content");
      return false;
    }
    decoding.readVarString(decoder);
    return decoding.hasContent(decoder);
  } catch (e) {
    logger.error("need send checked failed", e);
  }
  return false;
};
