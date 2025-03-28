// @ts-ignore
import awarenessProtocol from "y-protocols/dist/awareness.cjs";
import { docs, getYDoc, messageSync } from "../../collar/yjs_utils.js";
import { WSSharedDoc } from "../../collar/ws_share_doc.js";
import log4js from "log4js";
import { persistencePostgresql } from "../../storage/storage.js";
import { Socket } from "socket.io";
var logger = log4js.getLogger();
// @ts-ignore
import encoding from "lib0/dist/encoding.cjs";
// @ts-ignore
import decoding from "lib0/dist/decoding.cjs";
// @ts-ignore
import syncProtocol from "y-protocols/dist/sync.cjs";
import { SyncMessageType } from "../../model/texhub/sync_msg_type.js";
import { getTexFileInfo } from "../../storage/appfile.js";
import { handleControlSignals } from "./event/app_control_handler.js";

const wsReadyStateOpen = 1;

export const closeConn = (doc: WSSharedDoc, conn: Socket) => {
  if (doc.conns.has(conn)) {
    const controlledIds = doc.conns.get(conn);
    doc.conns.delete(conn);
    awarenessProtocol.removeAwarenessStates(
      doc.awareness,
      Array.from(controlledIds!),
      null
    );
    if (doc.conns.size === 0 && persistencePostgresql !== null) {
      // if persisted, we store state and destroy ydocument
      persistencePostgresql.writeState(doc.name, doc).then(() => {
        doc.destroy();
      });
      docs.delete(doc.name);
    }
  }
};

export const sendWithType = async (
  doc: WSSharedDoc,
  conn: Socket,
  m: Uint8Array
) => {
  try {
    if (conn.connected) {
      // https://stackoverflow.com/questions/16518153/get-connection-status-on-socket-io-client
      conn.send(m);
    } else {
      logger.warn("connection state is not open, doc:" + doc.name);
      closeConn(doc, conn);
    }
  } catch (e) {
    const decoder = new TextDecoder("utf-8");
    const text = decoder.decode(m);
    logger.error("send message facing error,text:" + text, e);
    closeConn(doc, conn);
  }
};

export const send = async (doc: WSSharedDoc, conn: Socket, m: Uint8Array) => {
  try {
    if (conn.connected) {
      // https://stackoverflow.com/questions/16518153/get-connection-status-on-socket-io-client
      conn.send(m);
    } else {
      let fileInfo = await getTexFileInfo(doc.name);
      logger.warn(
        "connection state is not open, doc:" +
          doc.name +
          ",file info:" +
          fileInfo.name
      );
      closeConn(doc, conn);
    }
  } catch (e) {
    const decoder = new TextDecoder("utf-8");
    const text = decoder.decode(m);
    logger.error("send message facing error,text:" + text, e);
    closeConn(doc, conn);
  }
};

/**
 *
 * @param {encoding.Encoder} encoder
 */
const needSend = (encoder: any) => {
  const buf = encoding.toUint8Array(encoder);
  const decoder = decoding.createDecoder(buf);
  decoding.readVarUint(decoder);
  decoding.readVarString(decoder);
  return decoding.hasContent(decoder);
};

/**
 * relationship of main doc & sub docs
 * @type {Map<String, Map<String, WSSharedDoc>>} mainDocID, subDocID
 */
const subdocsMap: Map<String, Map<String, WSSharedDoc>> = new Map();

export const messageListener = (
  conn: Socket,
  doc: WSSharedDoc,
  message: Uint8Array
) => {
  try {
    const encoder = encoding.createEncoder();
    const decoder = decoding.createDecoder(message);
    const messageType: number = decoding.readVarUint(decoder);
    switch (messageType) {
      case SyncMessageType.MessageSync:
        let targetDoc = doc
        const docGuid = decoding.readVarString(decoder)
        if (docGuid !== doc.name) {
          // subdoc
          targetDoc = getYDoc(docGuid, false)
          if (!targetDoc.conns.has(conn)) targetDoc.conns.set(conn, new Set())

          /**@type {Map<String, Boolean>}*/ const subm = subdocsMap.get(doc.name)
          if (subm && subm.has(targetDoc.name)) {
            // sync step 1 done before.
          } else {
            if (subm) {
              subm.set(targetDoc.name, targetDoc)
            } else {
              const nm = new Map()
              nm.set(targetDoc.name, targetDoc)
              subdocsMap.set(doc.name, nm)
            }

            // send sync step 1
            const encoder = encoding.createEncoder()
            encoding.writeVarUint(encoder, messageSync)
            encoding.writeVarString(encoder, targetDoc.name)
            syncProtocol.writeSyncStep1(encoder, targetDoc)
            send(targetDoc, conn, encoding.toUint8Array(encoder))
          }

        }
        //preHandleSubDoc(targetDoc, conn, decoder);
        encoding.writeVarUint(encoder, messageSync);
        // syncProtocol.readSyncMessage(decoder, encoder, doc, conn);
        syncProtocol.readSyncMessage(decoder, encoder, targetDoc, null);

        // If the `encoder` only contains the type of reply message and no
        // message, there is no need to send the message. When `encoder` only
        // contains the type of reply, its length is 1.
        if (encoding.length(encoder) > 1 && needSend(encoder)) {
          send(targetDoc, conn, encoding.toUint8Array(encoder));
        }
        break;
      case SyncMessageType.MessageAwareness: {
        awarenessProtocol.applyAwarenessUpdate(
          doc.awareness,
          decoding.readVarUint8Array(decoder),
          conn
        );
        break;
      }
      case SyncMessageType.MessageControl: {
        handleControlSignals(message, conn);
        break;
      }
      default:
        logger.error("unknown message type" + messageType);
        break;
    }
  } catch (err) {
    logger.error("message listener error", err);
    // doc.emit("error", [err]);
  }
};

const preHandleSubDoc = (doc: WSSharedDoc, conn: Socket, decoder: any) => {
  try {
    let targetDoc = doc;
    const docGuid = decoding.readVarString(decoder);
    if (docGuid !== doc.name) {
      handleSubDoc(targetDoc, docGuid, conn, doc);
    }
  } catch (err) {
    logger.error("handle sub doc facing issue", err);
  }
};

const handleSubDoc = (
  targetDoc: WSSharedDoc,
  docGuid: string,
  conn: Socket,
  doc: WSSharedDoc
) => {
  // subdoc
  targetDoc = getYDoc(docGuid, false);
  if (!targetDoc.conns.has(conn)) targetDoc.conns.set(conn, new Set());

  /**@type {Map<String, Boolean>}*/ const subm = subdocsMap.get(doc.name);
  if (subm && subm.has(targetDoc.name)) {
    // sync step 1 done before.
  } else {
    if (subm) {
      subm.set(targetDoc.name, targetDoc);
    } else {
      const nm = new Map();
      nm.set(targetDoc.name, targetDoc);
      subdocsMap.set(doc.name, nm);
    }

    // send sync step 1
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    encoding.writeVarString(encoder, targetDoc.name);
    syncProtocol.writeSyncStep1(encoder, targetDoc);
    send(targetDoc, conn, encoding.toUint8Array(encoder));
  }
};
