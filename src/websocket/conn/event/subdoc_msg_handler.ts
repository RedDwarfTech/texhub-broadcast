import { Socket } from "socket.io";
import { WSSharedDoc } from "@collar/ws_share_doc.js";
// @ts-ignore
import * as encoding from "rdlib0/dist/encoding.mjs";
// @ts-ignore
import * as decoding from "rdlib0/dist/decoding.mjs";
import logger from "@common/log4js_config.js";
import { getYDoc } from "@collar/yjs_utils.js";
import { SyncMessageType } from "@model/texhub/sync_msg_type.js";
import { send } from "../ws_action.js";
// @ts-ignore
import * as syncProtocol from "rdy-protocols/dist/sync.mjs";
import { PostgresqlPersistance } from "@/storage/adapter/postgresql/postgresql_persistance.js";
import { persistencePostgresql } from "@/storage/storage.js";
import { SyncFileAttr } from "@/model/texhub/sync_file_attr.js";
import { getTexFileInfo } from "@/storage/appfile.js";
import { FileContent } from "@/model/texhub/file_content.js";
import { SyncMessageContext } from "@/model/texhub/sync_msg_context.js";

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

function hasJsonStructure(str: string) {
  if (typeof str !== "string") return false;
  try {
    const result = JSON.parse(str);
    const type = Object.prototype.toString.call(result);
    return type === "[object Object]" || type === "[object Array]";
  } catch (err) {
    return false;
  }
}

const preHandleSubDoc = async (
  decoder: any,
  conn: Socket,
  rootDoc: WSSharedDoc
) => {
  try {
    const encoder = encoding.createEncoder();
    const context = decoding.readVarString(decoder);
    const isJson = hasJsonStructure(context);
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
      let docIntId = "";
      if (fileInfo) {
        docIntId = fileInfo.id;
      }
    }
    let syncFileAttr: SyncFileAttr = {
      docName: subdocGuid,
      projectId: rootDoc.name,
      docIntId: docIntId,
    };
    let memoryOrDiskSubdoc = await getYDoc(syncFileAttr);
    let curSubDoc = memoryOrDiskSubdoc;
    if (subdocGuid !== rootDoc.name) {
      // current document id not equal to root document
      // this is a subdocument
      // the subdocument message format: [messageSyncSub][subdocId][messageType][data]
      logger.warn(
        "this is an subdocument,subDocMessageType,doc guid:" +
          subdocGuid +
          ",finfo:" +
          JSON.stringify(fileInfo!)
      );
      let subdocText = memoryOrDiskSubdoc.getText(subdocGuid);
      let subdocTextStr = subdocText.toString();
      if (subdocTextStr) {
        curSubDoc = memoryOrDiskSubdoc;
      } else {
        console.warn(
          "subdocTextStr is empty,guid:" +
            subdocGuid +
            ",finfo:" +
            JSON.stringify(fileInfo!)
        );
        // try to get document from database directly
        const postgresqlDb: PostgresqlPersistance =
          persistencePostgresql.provider;
        const persistedYdoc: any = await postgresqlDb.getYDoc(syncFileAttr);
        let dbSubdocText = persistedYdoc.getText(subdocGuid);
        let dbSubdocTextStr = dbSubdocText.toString();
        console.log(
          "dbSubdocTextStr from database:" +
            dbSubdocTextStr +
            ",doc:" +
            subdocGuid +
            ",finfo:" +
            JSON.stringify(fileInfo!)
        );
        curSubDoc = persistedYdoc;
      }
      handleSubDoc(curSubDoc, subdocGuid, conn, rootDoc);
    }
    try {
      encoding.writeVarUint(encoder, SyncMessageType.SubDocMessageSync);
      encoding.writeVarString(encoder, subdocGuid);
      if (decoding.hasContent(decoder)) {
        syncProtocol.readSyncMessage(decoder, encoder, curSubDoc, null);
        if (encoding.length(encoder) > 1 && needSend(encoder)) {
          send(curSubDoc, conn, encoding.toUint8Array(encoder));
        }
      }
    } catch (e) {
      logger.error("write sub document sync failed, docGuid:" + subdocGuid, e);
    }
  } catch (err) {
    logger.error("handle sub doc facing issue:" + rootDoc.name, err);
  }
};

const handleSubDoc = (
  curSubDoc: WSSharedDoc,
  subdocGuid: string,
  conn: Socket,
  rootDoc: WSSharedDoc
) => {
  if (!rootDoc.conns.has(conn)) rootDoc.conns.set(conn, new Set());
  const curSubdocMap: Map<String, WSSharedDoc> | undefined = subdocsMap.get(
    rootDoc.name
  );
  if (curSubdocMap && curSubdocMap.has(subdocGuid)) {
    // sync step 1 done before.
  } else {
    if (curSubdocMap) {
      rootDoc.getMap("texhubsubdocs").set(subdocGuid, curSubDoc);
      curSubdocMap.set(subdocGuid, curSubDoc);
    } else {
      const newMap = new Map<String, WSSharedDoc>();
      newMap.set(subdocGuid, curSubDoc);
      subdocsMap.set(rootDoc.name, newMap);
    }

    const broadcastSubDocUpdate = (update: Uint8Array, origin: any) => {
      if (origin === conn) return; // Don't broadcast back to the sender

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, SyncMessageType.SubDocMessageSync);
      encoding.writeVarString(encoder, subdocGuid);
      syncProtocol.writeUpdate(encoder, update);

      rootDoc.conns.forEach((_, clientConn) => {
        if (clientConn !== conn) {
          logger.warn("broadcast....");
          //send(curSubDoc, clientConn, encoding.toUint8Array(encoder));
        }
      });
    };

    // send sync step 1
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, SyncMessageType.SubDocMessageSync);
    encoding.writeVarString(encoder, subdocGuid);
    syncProtocol.writeSyncStep1(encoder, curSubDoc);
    send(curSubDoc, conn, encoding.toUint8Array(encoder));
    // Register update handler for the subdocument
    // @ts-ignore - Y.Doc has on method but TypeScript doesn't know about it
    curSubDoc.on("update", broadcastSubDocUpdate);
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
