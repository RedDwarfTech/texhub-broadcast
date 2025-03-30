// @ts-ignore
import awarenessProtocol from "y-protocols/dist/awareness.cjs";
import { docs, messageSync } from "@collar/yjs_utils.js";
import { WSSharedDoc } from "@collar/ws_share_doc.js";
import log4js from "log4js";
import { persistencePostgresql } from "@storage/storage.js";
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
import { handleSubDocMsg } from "./event/subdoc_msg_handler.js";

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
      case SyncMessageType.SubDocMessageSync:
        handleSubDocMsg(doc, conn, message);
        break;
      case SyncMessageType.MessageSync:
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.readSyncMessage(decoder, encoder, doc, conn);

        // If the `encoder` only contains the type of reply message and no
        // message, there is no need to send the message. When `encoder` only
        // contains the type of reply, its length is 1.
        if (encoding.length(encoder) > 1) {
          send(doc, conn, encoding.toUint8Array(encoder));
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
  }
};
