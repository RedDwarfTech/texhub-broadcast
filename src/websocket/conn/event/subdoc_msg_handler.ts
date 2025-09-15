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
  // 读取原始update内容（假设decoder为Uint8Array或可转为Uint8Array）
  let rawUpdate;
  try {
    if (decoder instanceof Uint8Array) {
      rawUpdate = decoder;
    } else if (decoder && decoder.arr) {
      rawUpdate = decoder.arr instanceof Uint8Array ? decoder.arr : new Uint8Array(decoder.arr);
    } else {
      rawUpdate = undefined;
    }
    if (rawUpdate) {
      let crypto;
      try {
        crypto = await import("crypto");
      } catch (e) {
        logger.warn("crypto import failed", e);
      }
      if (crypto) {
        const updateHash = crypto.createHash("sha256").update(rawUpdate).digest("hex");
        const getRedisClient = (await import("@/storage/adapter/postgresql/conf/database_init.js")).getRedisClient;
        const redisClient = await getRedisClient();
        const redisKey = `subdocmsg_updatehash:${rootDoc.name}:${updateHash}`;
        if (redisClient) {
          const exists = await redisClient.get(redisKey);
          if (exists) {
            logger.warn(`[handleSubDocMsg] 检测到重复消息，hash=${updateHash}, doc=${rootDoc.name}, connId=${conn.id}`);
            logger.warn(`[handleSubDocMsg] 上下文:`, {
              docName: rootDoc.name,
              connId: conn.id,
              rawUpdateLen: rawUpdate.length,
              rawUpdate,
            });
            return;
          }
          await redisClient.set(redisKey, "1", "EX", 86400);
        }
      }
    }
  } catch (e) {
    logger.warn("subdocMsg hash check error", e);
  }
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
        curSubDoc = persistedYdoc;
      }
      handleSubDoc(curSubDoc, subdocGuid, conn, rootDoc, syncFileAttr);
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
  rootDoc: WSSharedDoc,
  syncFileAttr: SyncFileAttr
) => {
  if (!rootDoc.conns.has(conn)) rootDoc.conns.set(conn, new Set());
  const curSubdocMap: Map<String, WSSharedDoc> | undefined = subdocsMap.get(
    rootDoc.name
  );
  const handleSubDocUpdate = async (update: Uint8Array, origin: any) => {
    if (origin === conn) return; // Don't broadcast back to the sender

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, SyncMessageType.SubDocMessageSync);
    encoding.writeVarString(encoder, subdocGuid);
    syncProtocol.writeUpdate(encoder, update);

    rootDoc.conns.forEach(
      (
        _,
        clientConn: Socket<
          DefaultEventsMap,
          DefaultEventsMap,
          DefaultEventsMap,
          any
        >
      ) => {
        if (clientConn !== conn) {
          logger.warn("broadcast....,id:" + clientConn.id);
          send(curSubDoc, clientConn, encoding.toUint8Array(encoder));
        }
      }
    );
    const persistedYdoc: Y.Doc = await postgresqlDb.getYDoc(syncFileAttr);
    handleYDocUpdate(update, curSubDoc, syncFileAttr, persistedYdoc, true);
  };
  // @ts-ignore
  curSubDoc.on("update", handleSubDocUpdate);
  const subDocText = curSubDoc.getText(subdocGuid);
  subDocText.observe((event: Y.YTextEvent, tr: Y.Transaction) => {
    logger.warn(
      "sub document text changed,docGuid:" +
        subdocGuid +
        ",delta:" +
        JSON.stringify(event.delta)
    );
  });
  if (curSubdocMap && curSubdocMap.has(subdocGuid)) {
    // sync step 1 done before.
  } else {
    let docMeta: DocMeta = {
      name: subdocGuid,
      id: syncFileAttr.docIntId!,
      src: "server",
    };
    if (curSubdocMap) {
      curSubDoc.meta = docMeta;
      rootDoc.getMap("texhubsubdoc").set(subdocGuid, curSubDoc);
      curSubdocMap.set(subdocGuid, curSubDoc);
    } else {
      const newMap = new Map<String, WSSharedDoc>();
      curSubDoc.meta = docMeta;
      newMap.set(subdocGuid, curSubDoc);
      subdocsMap.set(rootDoc.name, newMap);
    }

    // send sync step 1
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, SyncMessageType.SubDocMessageSync);
    encoding.writeVarString(encoder, subdocGuid);
    syncProtocol.writeSyncStep1(encoder, curSubDoc);
    send(curSubDoc, conn, encoding.toUint8Array(encoder));
    // Register update handler for the subdocument
    // @ts-ignore - Y.Doc has on method but TypeScript doesn't know about it
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
