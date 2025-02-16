// @ts-ignore
import awarenessProtocol from "y-protocols/dist/awareness.cjs";
import { docs, messageSync } from "../../yjs/yjs_utils.js";
import { messageAwareness, WSSharedDoc } from "../../yjs/ws_share_doc.js";
import log4js from "log4js";
import { persistence } from "../../storage/leveldb.js";
import { Socket } from "socket.io";
var logger = log4js.getLogger();
// @ts-ignore
import encoding from "lib0/dist/encoding.cjs";
// @ts-ignore
import decoding from "lib0/dist/decoding.cjs";
// @ts-ignore
import syncProtocol from "y-protocols/dist/sync.cjs";

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
    if (doc.conns.size === 0 && persistence !== null) {
      // if persisted, we store state and destroy ydocument
      persistence.writeState(doc.name, doc).then(() => {
        doc.destroy();
      });
      docs.delete(doc.name);
    }
  }
};

export const sendWithType = (doc: WSSharedDoc, conn: Socket, m: Uint8Array) => {
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

export const send = (doc: WSSharedDoc, conn: Socket, m: Uint8Array) => {
  try {
    if (conn.connected) {
      logger.debug("send message:" + m);
      conn.send("hello");
      conn.emit("message", "d");
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
      case messageSync:
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.readSyncMessage(decoder, encoder, doc, conn);

        // If the `encoder` only contains the type of reply message and no
        // message, there is no need to send the message. When `encoder` only
        // contains the type of reply, its length is 1.
        if (encoding.length(encoder) > 1) {
          send(doc, conn, encoding.toUint8Array(encoder));
        }
        break;
      case messageAwareness: {
        awarenessProtocol.applyAwarenessUpdate(
          doc.awareness,
          decoding.readVarUint8Array(decoder),
          conn
        );
        break;
      }
    }
  } catch (err) {
    logger.error("message listener error," + err);
    // doc.emit("error", [err]);
  }
};
