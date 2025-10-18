import { Socket } from "socket.io";
import { WSSharedDoc } from "@collar/ws_share_doc.js";
// @ts-ignore
import * as encoding from "rdlib0/dist/encoding.mjs";
// @ts-ignore
import * as Y from "rdyjs";
// @ts-ignore
import * as decoding from "rdlib0/dist/decoding.mjs";
import logger from "@common/log4js_config.js";
import { getYDoc } from "@collar/yjs_utils.js";
import { SyncMessageType } from "@model/texhub/sync_msg_type.js";
import { send } from "../../action/ws_action.js";
// @ts-ignore
import * as syncProtocol from "rdy-protocols/dist/sync.mjs";
import { SyncFileAttr } from "@/model/texhub/sync_file_attr.js";
import { getTexFileInfo } from "@/storage/appfile.js";
import { FileContent } from "@/model/texhub/file_content.js";
import { SyncMessageContext } from "@/model/texhub/sync_msg_context.js";
import { handleYDocUpdate } from "@/storage/handler/ydoc_action_handler.js";
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

let cryptoModule: any | null = null;

/**
 * relationship of main doc & sub docs
 * @type {Map<String, Map<String, WSSharedDoc>>} mainDocID, subDocID
 */
const subdocsMap: Map<String, Map<String, WSSharedDoc>> = new Map();

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
      // basic defensive check
      if (origin === conn) return;

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

      await handleSubDocUpdate(update, origin, curSubDoc, snapshotSubdocGuid, conn, deepCopied, rootDoc);
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
  try {
    const encoder = encoding.createEncoder();
    const context = decoding.readVarString(decoder);
    const isJson = RdJsonUtil.hasJsonStructure(context);
    const docContext = isJson ? JSON.parse(context) : context;
    const subdocGuid = isJson ? docContext.doc_name : docContext;
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
    let memoryOrDiskSubdoc = await getYDoc(syncFileAttr);
    let curSubDoc = memoryOrDiskSubdoc;
    if (subdocGuid !== rootDoc.name) {
      // current document id not equal to root document
      // this is a subdocument
      // the subdocument message format: [messageSyncSub][subdocId][messageType][data]
      let subdocText = memoryOrDiskSubdoc.getText(subdocGuid);
      let subdocTextStr = subdocText.toString();
      if (subdocTextStr) {
        curSubDoc = memoryOrDiskSubdoc;
      } else {
        logger.warn(
          "subdocTextStr is empty,guid:" +
            subdocGuid +
            ",finfo:" +
            JSON.stringify(fileInfo!) +
            ",socket-id:" +
            conn.id +
            ",docContext:" +
            JSON.stringify(docContext) +
            ",projectId:" +
            rootDoc.name
        );
      }
    }
    handleSubDoc(curSubDoc, conn, rootDoc, syncFileAttr, decoder, encoder);
  } catch (err) {
    logger.error("handle sub doc facing issue:" + rootDoc.name, err);
  }
};

const handleNormalMsg = (
  rootDoc: WSSharedDoc,
  conn: Socket,
  decoder: any,
  encoder: any,
  curSubDoc: WSSharedDoc,
  syncFileAttr: SyncFileAttr
) => {
  let subdocGuid = syncFileAttr.docName;
  const curSubdocMap: Map<String, WSSharedDoc> | undefined = subdocsMap.get(
    rootDoc.name
  );
  try {
    if (curSubdocMap && curSubdocMap.has(subdocGuid)) {
      encoding.writeVarUint(encoder, SyncMessageType.SubDocMessageSync);

      const uniqueValue = uuidv4();
      let msg: SyncMessageContext = {
        doc_name: subdocGuid,
        src: "handleNormalMsg",
        trace_id: uniqueValue,
      };
      let msgStr = JSON.stringify(msg);

      encoding.writeVarString(encoder, msgStr);
      if (decoding.hasContent(decoder)) {
        if (subdocGuid === rootDoc.name) {
          syncProtocol.readSyncMessage(decoder, encoder, rootDoc, conn);
          if (encoding.length(encoder) > 1 && needSend(encoder)) {
            send(rootDoc, conn, encoding.toUint8Array(encoder), syncFileAttr);
          }
        } else {
          syncProtocol.readSyncMessage(decoder, encoder, curSubDoc, conn);
          if (encoding.length(encoder) > 1 && needSend(encoder)) {
            send(curSubDoc, conn, encoding.toUint8Array(encoder), syncFileAttr);
          }
        }
      }
    }
  } catch (e) {
    logger.error("write sub document sync failed, docGuid:" + subdocGuid, e);
  }
};

const handleSubDocUpdate = async (
  update: Uint8Array,
  origin: any,
  curSubDoc: WSSharedDoc,
  subdocGuid: string,
  conn: Socket,
  syncFileAttr: SyncFileAttr,
  rootDoc: WSSharedDoc
) => {
  if (origin === conn) return; // Don't broadcast back to the sender
  serverWriteUpdate(update, subdocGuid);
  if (subdocGuid !== rootDoc.name) {
    handleYDocUpdate(update, curSubDoc, syncFileAttr);
  }
};

const handleSubDoc = (
  curSubDoc: WSSharedDoc,
  conn: Socket,
  rootDoc: WSSharedDoc,
  syncFileAttr: SyncFileAttr,
  decoder: any,
  encoder: any
) => {
  let subdocGuid = syncFileAttr.docName;
  if (!rootDoc.conns.has(conn)) {
    rootDoc.conns.set(conn, new Set());
  }
  const curSubdocMap: Map<String, WSSharedDoc> | undefined = subdocsMap.get(
    rootDoc.name
  );
  if (syncFileAttr.msgBody) {
    if (
      syncFileAttr.msgBody.msg_type &&
      syncFileAttr.msgBody.msg_type === "sync_step_1"
    ) {
      writeSyncStep2(curSubDoc, conn, syncFileAttr);
      logger.debug("recieved send sync step 1 again, docGuid:" + subdocGuid);
    }
  }
  if (curSubdocMap && curSubdocMap.has(subdocGuid)) {
    // sync step 1 done before.
    handleNormalMsg(rootDoc, conn, decoder, encoder, curSubDoc, syncFileAttr);
  } else {
    handleSubDocFirstTimePut(
      curSubdocMap,
      subdocGuid,
      curSubDoc,
      rootDoc,
      conn,
      syncFileAttr
    );
  }
};

const handleSubDocFirstTimePut = (
  curSubdocMap: Map<String, WSSharedDoc> | undefined,
  subdocGuid: string,
  curSubDoc: WSSharedDoc,
  rootDoc: WSSharedDoc,
  conn: Socket,
  syncFileAttr: SyncFileAttr
) => {
  try {
    // register a stable handler created from a snapshot of current context
    // avoid double registration by storing handler reference on the doc
    // @ts-ignore
    if (!(curSubDoc as any).__subdocUpdateHandler) {
      const snapshotSyncFileAttr = structuredClone(syncFileAttr);
      const snapshotSubdocGuid = String(subdocGuid);
      const snapshotRootName = rootDoc.name;

      // create handler via factory to keep code clear
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
      // curSubDoc.on("update", handler);
    } else {
      logger.debug(`update handler already registered for subdoc ${subdocGuid}`);
    }
    const subDocText = curSubDoc.getText(subdocGuid);
    subDocText.observe((event: Y.YTextEvent, tr: Y.Transaction) => {
      /**logger.debug(
        "sub document text changed,docGuid:" +
          subdocGuid +
          ",delta:" +
          JSON.stringify(event.delta)
      );*/
    });
    let docMeta: DocMeta = {
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
  } catch (e) {
    logger.error("handle first time put failed, docGuid:" + subdocGuid, e);
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
