import log4js from "log4js";
import { getYDoc, messageSync } from "../../yjs/yjs_utils";
import { closeConn, messageListener, send } from "../conn/ws_action";
var logger = log4js.getLogger();
// @ts-ignore
import encoding from "lib0/dist/encoding.cjs";
// @ts-ignore
import decoding from "lib0/dist/decoding.cjs";
// @ts-ignore
import syncProtocol from "y-protocols/dist/sync.cjs";
import { messageAwareness } from "../../yjs/ws_share_doc";
// @ts-ignore
import awarenessProtocol from "y-protocols/dist/awareness.cjs";
import { Socket } from "socket.io";
import http from "http";

export function setupWSConnection(
  conn: Socket,
  req: http.IncomingMessage,
  { docName = req.url!.slice(1).split("?")[0], gc = true } = {}
) {
  // handleAuth(req, conn);
  // conn.binaryType = "arraybuffer";
  // get doc, initialize if it does not exist yet
  const doc = getYDoc(docName, gc);
  doc.conns.set(conn, new Set());
  // listen and reply to events
  conn.on(
    "message",
    (message) => {
        messageListener(conn, doc, new Uint8Array(message));
    }
  );
  // Check if connection is still alive
  let pongReceived = true;
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
          docName
      );
    }
    closeConn(doc, conn);
  });
  conn.on("pong", () => {
    pongReceived = true;
  });
  // put the following in a variables in a block so the interval handlers don't keep in in
  // scope
  {
    // send sync step 1
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, doc);
    send(doc, conn, encoding.toUint8Array(encoder));
    const awarenessStates = doc.awareness.getStates();
    if (awarenessStates.size > 0) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(
          doc.awareness,
          Array.from(awarenessStates.keys())
        )
      );
      send(doc, conn, encoding.toUint8Array(encoder));
    }
  }
}
