import { getYDoc, messageSync } from "@collar/yjs_utils.js";
import { closeConn, send } from "../../action/ws_action.js";
import {
  createEncoder,
  toUint8Array,
  writeVarUint,
  writeVarUint8Array,
  // @ts-ignore
} from "lib0/encoding";
// @ts-ignore
import * as syncProtocol from "y-protocols/sync";
import { messageAwareness, WSSharedDoc } from "@collar/ws_share_doc.js";
// @ts-ignore
import * as awarenessProtocol from "y-protocols/awareness";
import { Socket } from "socket.io";
import http from "http";
import logger from "@common/log4js_config.js";
import { ws_msg_handle } from "./message_handler.js";
import { URLSearchParams } from "url";
import { SyncFileAttr } from "@/model/texhub/sync_file_attr.js";
import { TeXFileType } from "@/model/enum/tex_file_type.js";

export async function setupWSConnection(
  socket: Socket,
  { gc = true } = {}
) {
  let req : http.IncomingMessage = socket.request;
  let url: URL = new URL(req.url!, `http://${req.headers.host}`);
  let urlParams: URLSearchParams = url.searchParams;
  const docId = urlParams.get("docId");
  const docIntIdParam = urlParams.get("docIntId");
  const projId = urlParams.get("projId");
  const docType = urlParams.get("docType");
  const docShowName = urlParams.get("docShowName");
  // 根文档若是 PROJECT 容器（subdoc 模式），docIntId 不应携带活动文件的 id，
  // 否则会与子文档共用同一个 docIntId，导致历史快照池/Redis 挂起标记被根文档（空内容）污染。
  let docIntId = Number(docType) === TeXFileType.PROJECT ? "" : (docIntIdParam || "");
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
  rootDoc.conns.set(socket, new Set());
  // listen and reply to events
  socket.on("message", (message: Uint8Array) => {
    ws_msg_handle(message, socket, rootDoc);
  });
  socket.on("probe", (data: any) => {
    socket.emit("probe_ack", {
      doc: data && data.doc,
      probeId: data && data.probeId,
      ack: true,
      serverTime: new Date().toISOString(),
    });
  });
  socket.on("disconnect", () => {
    closeConn(rootDoc, socket);
  });
  socket.on("close", (code, reason, wasClean) => {
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
    closeConn(rootDoc, socket);
  });
  // put the following in a variables in a block so the interval handlers don't keep in in
  // scope
  {
    // send sync step 1
    const encoder = createEncoder();
    writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, rootDoc);
    send(rootDoc, socket, toUint8Array(encoder), syncFileAttr);
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
      send(rootDoc, socket, toUint8Array(encoder), syncFileAttr);
    }
  }
}
