// @ts-ignore
import * as awarenessProtocol from "y-protocols/awareness";
import { docs, messageSync } from "@collar/yjs_utils.js";
import { WSSharedDoc } from "@collar/ws_share_doc.js";
import log4js from "log4js";
import { persistencePostgresql } from "@storage/storage.js";
import { Socket } from "socket.io";
var logger = log4js.getLogger();
// @ts-ignore
import * as encoding from "lib0/encoding";
// @ts-ignore
import * as decoding from "lib0/decoding";
// @ts-ignore
import * as bc from "lib0/broadcastchannel";
import {
  createEncoder,
  toUint8Array,
  writeVarUint,
  // @ts-ignore
} from "lib0/encoding";
// @ts-ignore
import * as syncProtocol from "y-protocols/sync";
import { SyncMessageType } from "@model/texhub/sync_msg_type.js";
import { getTexFileInfo } from "@storage/appfile.js";
import { handleControlSignals } from "../event/server/app_control_handler.js";
import {
  handleSubDocMsg,
  clearSubdocsForRootDoc,
} from "../event/server/subdoc_msg_handler.js";
import { SocketIOClientProvider } from "../socket_io_client_provider.js";
import {
  createDecoder,
  readVarUint,
  // @ts-ignore
} from "lib0/decoding";
import { SyncFileAttr } from "@/model/texhub/sync_file_attr.js";
import { cleanupHistoryDocForProject } from "@/common/app/throttle_util.js";

/**
 * send message without broadcast
 * @param {WebsocketProvider} provider
 * @param {Uint8Array} buf
 */
export const sendMessage = (
  provider: SocketIOClientProvider,
  buf: Uint8Array
) => {
  const ws = provider.ws;
  if (provider.wsconnected && ws && ws.connected) {
    ws.send(buf);
  }
};

/**
 * @param {WebsocketProvider} provider
 * @param {Uint8Array} buf
 */
export const broadcastMessage = (
  provider: SocketIOClientProvider,
  buf: Uint8Array
) => {
  const ws = provider.ws;
  if (provider.wsconnected && ws && ws.connected) {
    ws.send(buf);
  }
  if (provider.bcconnected) {
    bc.publish(provider.bcChannel, buf, provider);
  }
};

export const readMessage = (
  provider: SocketIOClientProvider,
  buf: Uint8Array,
  emitSynced: boolean
) => {
  const decoder = createDecoder(buf);
  const encoder = createEncoder();
  const messageType = readVarUint(decoder);
  const messageHandler = provider.messageHandlers[messageType];
  if (messageHandler) {
    messageHandler(encoder, decoder, provider, emitSynced, messageType);
  } else {
    console.error("Unable to compute message");
  }
  return encoder;
};

export const closeConn = (doc: WSSharedDoc, conn: Socket) => {
  if (doc.conns.has(conn)) {
    const controlledIds = doc.conns.get(conn);
    doc.conns.delete(conn);
    awarenessProtocol.removeAwarenessStates(
      doc.awareness,
      Array.from(controlledIds!),
      null
    );
    try {
      // try to remove subdoc update handlers associated with this connection
      const subdocMap = (doc.getMap && doc.getMap("texhubsubdoc")) || null;
      if (subdocMap && typeof subdocMap.forEach === "function") {
        subdocMap.forEach((subdoc: any, key: any) => {
          try {
            const handler = (subdoc as any).__subdocUpdateHandler;
            if (handler && typeof subdoc.off === "function") {
              subdoc.off("update", handler);
              delete (subdoc as any).__subdocUpdateHandler;
            }
          } catch (e) {
            // best-effort: log and continue
            logger.debug(`failed to remove subdoc handler for ${key}: ${e}`);
          }
        });
      }
    } catch (e) {
      logger.debug("error while removing subdoc handlers on closeConn", e);
    }
    if (doc.conns.size === 0 && persistencePostgresql !== null) {
      cleanupHistoryDocForProject(doc.name);
      // if persisted, we store state and destroy ydocument
      persistencePostgresql.writeState(doc.name, doc).then(() => {
        doc.destroy();
      });
      docs.delete(doc.name);
      clearSubdocsForRootDoc(doc.name);
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
      logger.warn("sendWithType connection state is not open, doc:" + doc.name);
      closeConn(doc, conn);
    }
  } catch (e) {
    const decoder = new TextDecoder("utf-8");
    const text = decoder.decode(m);
    logger.error("send message facing error,text:" + text, e);
    closeConn(doc, conn);
  }
};

export const sendPure = async (
  doc: WSSharedDoc,
  conn: Socket,
  msg: Uint8Array
) => {
  try {
    if (conn.connected) {
      // https://stackoverflow.com/questions/16518153/get-connection-status-on-socket-io-client
      conn.send(msg);
    } else {
      logger.warn("sendPure connection state is not open, doc:" + doc.name);
      console.trace();
      conn.send(msg);
      closeConn(doc, conn);
    }
  } catch (e) {
    const decoder = new TextDecoder("utf-8");
    const text = decoder.decode(msg);
    logger.error("send message facing error,text:" + text, e);
    closeConn(doc, conn);
  }
};

export const send = async (
  doc: WSSharedDoc,
  conn: Socket,
  msg: Uint8Array,
  syncFileAttr: SyncFileAttr
) => {
  try {
    if (conn.connected) {
      // https://stackoverflow.com/questions/16518153/get-connection-status-on-socket-io-client
      conn.send(msg);
    } else {
      logger.warn(
        "send connection state is not open, doc:" +
          doc.name +
          ",file info:" +
          JSON.stringify(syncFileAttr)
      );
      closeConn(doc, conn);
    }
  } catch (e) {
    const decoder = new TextDecoder("utf-8");
    const text = decoder.decode(msg);
    logger.error("send message facing error,text:" + text, e);
    closeConn(doc, conn);
  }
};

/**
 * P0：客户端 Outbox ACK（docs/design/message-reliable.md §5.3）。
 * `sync:ack`（服务端->客户端）：服务端已把该 seq 的 update 应用进内存 doc。
 */
export const emitSyncAck = (
  conn: Socket,
  doc: string,
  seq: number
) => {
  try {
    conn.emit("sync:ack", { doc, seq });
  } catch (e) {
    logger.error(`emit sync:ack failed for doc=${doc} seq=${seq}`, e);
  }
};

type SyncAckState = {
  /**
   * FIFO：本连接上"已应用但尚未被 sync:ack_req 消费"的文档名。
   * Socket.IO 对同一连接上的 message（二进制帧）与自定义事件保序，
   * 因此每个 sync:ack_req 与排在前面的应用标记一一对应，按序消费即可。
   */
  applied: string[];
  /**
   * ack_req 已达而对应应用标记未到（极少数乱序兜底）时先挂起，
   * 下次 markDocUpdateApplied 时再排空。
   */
  pending: Array<{ doc: string; seq: number }>;
};

const getSyncAckState = (conn: Socket): SyncAckState => {
  const key = "__syncAckState";
  const existing = (conn as any)[key];
  if (existing) return existing as SyncAckState;
  const state: SyncAckState = { applied: [], pending: [] };
  (conn as any)[key] = state;
  return state;
};

const consumeOneApplied = (conn: Socket): string | null => {
  const state = getSyncAckState(conn);
  if (state.pending.length > 0) return null;
  return state.applied.shift() ?? null;
};

/**
 * 服务端在成功应用完一条 Yjs update 后调用，把该 doc 加入 ACK FIFO。
 * 若此前有挂起的 ack_req（乱序兜底），顺便排空。
 */
export const markDocUpdateApplied = (conn: Socket, doc: string) => {
  if (!conn) return;
  const state = getSyncAckState(conn);
  state.applied.push(doc);
  while (state.pending.length > 0) {
    const req = state.pending.shift()!;
    emitSyncAck(conn, req.doc, req.seq);
  }
};

/**
 * 处理客户端 `sync:ack_req { doc, seq }`：
 * 同一连接上 ack_req 紧跟在对应 update 帧之后（Socket.IO 保序），
 * 从 FIFO 里消费一个已应用标记，用 ack_req 携带的 seq 回 `sync:ack`。
 */
export const handleSyncAckReq = (conn: Socket, payload: any) => {
  if (!conn) return;
  const doc = payload && payload.doc;
  const seq = payload && payload.seq;
  if (!doc || typeof seq !== "number") {
    logger.warn("invalid sync:ack_req payload", payload);
    return;
  }
  const state = getSyncAckState(conn);
  const applied = consumeOneApplied(conn);
  if (applied !== null) {
    emitSyncAck(conn, doc, seq);
    return;
  }
  // 应用标记尚未到达（乱序）：挂起，等下一次应用成功后补回执
  state.pending.push({ doc, seq });
};

const logSubDocRawMessage = (message: Uint8Array) => {
  try {
    const len = message.length;
    const hex = (arr: Uint8Array) =>
      Array.from(arr)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    const head = hex(message.slice(0, Math.min(len, 32)));
    const tail = hex(message.slice(Math.max(0, len - 32)));
    logger.info(`[raw SubDocMessageSync] len=${len} head=${head} tail=${tail}`);
  } catch (e) {
    // ignore
  }
};

export const messageListener = async (
  conn: Socket,
  rootDoc: WSSharedDoc,
  message: Uint8Array
) => {
  try {
    const encoder = encoding.createEncoder();
    const decoder = decoding.createDecoder(message);
    const messageType: number = decoding.readVarUint(decoder);
    switch (messageType) {
      case SyncMessageType.SubDocMessageSync:
        logSubDocRawMessage(message);
        /**
         * https://github.com/yjs/y-websocket/issues/81
         */
        await handleSubDocMsg(rootDoc, conn, decoder);
        break;
      case SyncMessageType.MessageSync:
        encoding.writeVarUint(encoder, messageSync);
        const hasContent = decoding.hasContent(decoder);
        syncProtocol.readSyncMessage(decoder, encoder, rootDoc, conn);
        if (hasContent) {
          // P0 Outbox ACK：该连接上已成功应用一条根文档 update，写入 ACK FIFO
          markDocUpdateApplied(conn, rootDoc.name);
        }

        // If the `encoder` only contains the type of reply message and no
        // message, there is no need to send the message. When `encoder` only
        // contains the type of reply, its length is 1.
        if (encoding.length(encoder) > 1) {
          sendPure(rootDoc, conn, encoding.toUint8Array(encoder));
        }
        break;
      case SyncMessageType.MessageAwareness: {
        awarenessProtocol.applyAwarenessUpdate(
          rootDoc.awareness,
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
        logger.error("unknown message type in messageListener" + messageType);
        break;
    }
  } catch (err) {
    logger.error("message listener error", err);
  }
};
