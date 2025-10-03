import { DefaultEventsMap, Socket } from "socket.io";
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
import { send } from "../ws_action.js";
// @ts-ignore
import * as syncProtocol from "rdy-protocols/dist/sync.mjs";
import { PostgresqlPersistance } from "@/storage/adapter/postgresql/postgresql_persistance.js";
import { persistencePostgresql, postgresqlDb } from "@/storage/storage.js";
import { SyncFileAttr } from "@/model/texhub/sync_file_attr.js";
import { getTexFileInfo } from "@/storage/appfile.js";
import { FileContent } from "@/model/texhub/file_content.js";
import { SyncMessageContext } from "@/model/texhub/sync_msg_context.js";
import { handleYDocUpdate } from "@/storage/handler/ydoc_action_handler.js";
import { DocMeta } from "@/model/yjs/commom/doc_meta.js";
import { redis } from "@/common/cache/redis_util.js";
import { v4 as uuidv4 } from "uuid";
import { RdJsonUtil } from "rdjs-wheel";

/**
 * relationship of main doc & sub docs
 * @type {Map<String, Map<String, WSSharedDoc>>} mainDocID, subDocID
 */
const subdocsMap: Map<String, Map<String, WSSharedDoc>> = new Map();

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
    let memoryOrDiskSubdoc = getYDoc(syncFileAttr);
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
        console.warn(
          "subdocTextStr is empty,guid:" +
            subdocGuid +
            ",finfo:" +
            JSON.stringify(fileInfo!) +
            ",socket-id:" +
            conn.id +
            ",docContext:" +
            JSON.stringify(docContext)
        );
      }
    }
    handleNormalMsg(rootDoc, conn, decoder, subdocGuid, encoder, curSubDoc);
    handleSubDoc(curSubDoc, subdocGuid, conn, rootDoc, syncFileAttr);
  } catch (err) {
    logger.error("handle sub doc facing issue:" + rootDoc.name, err);
  }
};

const handleNormalMsg = (
  rootDoc: WSSharedDoc,
  conn: Socket,
  decoder: any,
  subdocGuid: string,
  encoder: any,
  curSubDoc: WSSharedDoc
) => {
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
        syncProtocol.readSyncMessage(decoder, encoder, curSubDoc, null);
        if (encoding.length(encoder) > 1 && needSend(encoder)) {
          send(curSubDoc, conn, encoding.toUint8Array(encoder));
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
  syncFileAttr: SyncFileAttr
) => {
  if (origin === conn) return; // Don't broadcast back to the sender
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, SyncMessageType.SubDocMessageSync);

  const uniqueValue = uuidv4();
  let msg: SyncMessageContext = {
    doc_name: subdocGuid,
    src: "handleSubDocUpdate",
    trace_id: uniqueValue,
  };
  let msgStr = JSON.stringify(msg);

  encoding.writeVarString(encoder, msgStr);
  syncProtocol.writeUpdate(encoder, update);
  handleYDocUpdate(update, curSubDoc, syncFileAttr);
};

const handleSubDoc = (
  curSubDoc: WSSharedDoc,
  subdocGuid: string,
  conn: Socket,
  rootDoc: WSSharedDoc,
  syncFileAttr: SyncFileAttr
) => {
  if (!rootDoc.conns.has(conn)) {
    rootDoc.conns.set(conn, new Set());
  }
  const curSubdocMap: Map<String, WSSharedDoc> | undefined = subdocsMap.get(
    rootDoc.name
  );
  if (curSubdocMap && curSubdocMap.has(subdocGuid)) {
    // sync step 1 done before.
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
    // @ts-ignore
    curSubDoc.on("update", (update: Uint8Array, origin: Socket) => {
      if (origin === conn) return;
      const deepCopied = structuredClone(syncFileAttr);
      if (subdocGuid == rootDoc.name) {
        logger.warn(
          "the subdocGuid equal to rootDoc.name,skip update handler,syncFileAttr:" +
            JSON.stringify(syncFileAttr)
        );
        return;
      }
      
      deepCopied.src = deepCopied.src + "_subdoc_update";
      handleSubDocUpdate(
        update,
        origin,
        curSubDoc,
        subdocGuid,
        conn,
        deepCopied
      );
    });
    const subDocText = curSubDoc.getText(subdocGuid);
    subDocText.observe((event: Y.YTextEvent, tr: Y.Transaction) => {
      logger.warn(
        "sub document text changed,docGuid:" +
          subdocGuid +
          ",delta:" +
          JSON.stringify(event.delta)
      );
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
    sendSyncStep1(curSubDoc, subdocGuid, conn);
  } catch (e) {
    logger.error("handle first time put failed, docGuid:" + subdocGuid, e);
  }
};

const sendSyncStep1 = (
  curSubDoc: WSSharedDoc,
  subdocGuid: string,
  conn: Socket
) => {
  // send sync step 1
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, SyncMessageType.SubDocMessageSync);

  const uniqueValue = uuidv4();
  let msg: SyncMessageContext = {
    doc_name: subdocGuid,
    src: "sendSyncStep1submsghandler",
    trace_id: uniqueValue,
  };
  let msgStr = JSON.stringify(msg);

  encoding.writeVarString(encoder, msgStr);
  syncProtocol.writeSyncStep1(encoder, curSubDoc);
  send(curSubDoc, conn, encoding.toUint8Array(encoder));
  // Register update handler for the subdocument
  // @ts-ignore - Y.Doc has on method but TypeScript doesn't know about it
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
