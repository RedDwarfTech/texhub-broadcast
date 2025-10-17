import { getYDoc, messageSync } from "@collar/yjs_utils.js";
import { closeConn, send } from "../conn/action/ws_action.js";
import {
  createEncoder,
  toUint8Array,
  writeVarUint,
  writeVarUint8Array,
  // @ts-ignore
} from "rdlib0/dist/encoding.mjs";
// @ts-ignore
import * as syncProtocol from "rdy-protocols/dist/sync.mjs";
import { messageAwareness, WSSharedDoc } from "@collar/ws_share_doc.js";
// @ts-ignore
import * as awarenessProtocol from "rdy-protocols/dist/awareness.mjs";
import { Socket } from "socket.io";
import http from "http";
import logger from "@common/log4js_config.js";
import { ws_msg_handle } from "../conn/event/server/message_handler.js";
import { URLSearchParams } from "url";
import { SyncFileAttr } from "@/model/texhub/sync_file_attr.js";

export async function setupWSConnection(
  conn: Socket,
  req: http.IncomingMessage,
  { gc = true } = {}
) {
  let url: URL = new URL(req.url!, `http://${req.headers.host}`);
  let urlParams: URLSearchParams = url.searchParams;
  const docId = urlParams.get("docId");
  const docIntId = urlParams.get("docIntId");
  const projId = urlParams.get("projId");
  const docType = urlParams.get("docType");
  const docShowName = urlParams.get("docShowName");
  let syncFileAttr: SyncFileAttr = {
    docName: docId!,
    docType: Number(docType),
    projectId: projId!,
    docIntId: docIntId!,
    docShowName: docShowName || "unknown",
    src: "setupWSConnection"
  };
  // get doc, initialize if it does not exist yet
  const rootDoc: WSSharedDoc = await getYDoc(syncFileAttr, gc);
  rootDoc.conns.set(conn, new Set());
  // listen and reply to events
  conn.on("message", (message: Uint8Array) => {
    ws_msg_handle(message, conn, rootDoc);
  });
  conn.on("probe", (data: any) => {
    logger.info(`[probe] received probe from client`, {
      docId,
      connId: conn.id,
      probeData: data,
      time: new Date().toISOString(),
    });
    // 回复探测消息
    conn.emit("probe_ack", {
      doc: data && data.doc,
      probeId: data && data.probeId,
      ack: true,
      serverTime: new Date().toISOString(),
    });
    logger.info(`[probe] sent probe_ack to client`, {
      docId,
      connId: conn.id,
      probeId: data && data.probeId,
      time: new Date().toISOString(),
    });
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
    closeConn(rootDoc, conn);
  });
  // put the following in a variables in a block so the interval handlers don't keep in in
  // scope
  {
    // send sync step 1
    const encoder = createEncoder();
    writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, rootDoc);
    send(rootDoc, conn, toUint8Array(encoder), syncFileAttr);
    const awarenessStates = rootDoc.awareness.getStates();
    if (awarenessStates.size > 0) {
      const encoder = createEncoder();
      writeVarUint(encoder, messageAwareness);
      writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(
          rootDoc.awareness,
          Array.from(awarenessStates.keys())
        )
      );
      send(rootDoc, conn, toUint8Array(encoder), syncFileAttr);
    }
  }
}
