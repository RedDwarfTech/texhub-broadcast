import { getYDoc, messageSync } from "../../yjs/yjs_utils.js";
import { closeConn, send } from "../conn/ws_action.js";
import {
  createEncoder,
  toUint8Array,
  writeVarUint,
  writeVarUint8Array,
  // @ts-ignore
} from "lib0/dist/encoding.cjs";
// @ts-ignore
import syncProtocol from "y-protocols/dist/sync.cjs";
import { messageAwareness, WSSharedDoc } from "../../yjs/ws_share_doc.js";
// @ts-ignore
import awarenessProtocol from "y-protocols/dist/awareness.cjs";
import { Socket } from "socket.io";
import http from "http";
import logger from "../../common/log4js_config.js";
import { ws_msg_handle } from "../conn/event/message_handler.js";

export function setupWSConnection(
  conn: Socket,
  req: http.IncomingMessage,
  { gc = true } = {}
) {
  // handleAuth(req, conn);
  // conn.binaryType = "arraybuffer";
  const docId = new URL(
    req.url!,
    `http://${req.headers.host}`
  ).searchParams.get("docId");
  // get doc, initialize if it does not exist yet
  const doc: WSSharedDoc = getYDoc(docId!, gc);
  doc.conns.set(conn, new Set());
  // listen and reply to events
  conn.on("message", (message: Uint8Array) => {
    ws_msg_handle(message, conn, doc);
  });
  conn.on("close", (code, reason, wasClean) => {
    if (code !== 1000 && code !== 4001) {
      logger.error(
        "close reason:" +
          reason +
          ",code:" +
          code +
          ",wasClean:" +
          wasClean +
          ",the doc:" +
          docId
      );
    }
    closeConn(doc, conn);
  });
  // put the following in a variables in a block so the interval handlers don't keep in in
  // scope
  {
    // send sync step 1
    const encoder = createEncoder();
    writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, doc);
    send(doc, conn, toUint8Array(encoder));
    const awarenessStates = doc.awareness.getStates();
    if (awarenessStates.size > 0) {
      const encoder = createEncoder();
      writeVarUint(encoder, messageAwareness);
      writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(
          doc.awareness,
          Array.from(awarenessStates.keys())
        )
      );
      send(doc, conn, toUint8Array(encoder));
    }
  }
}
