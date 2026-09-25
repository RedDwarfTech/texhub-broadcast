// @ts-ignore
import * as awarenessProtocol from "y-protocols/awareness";
import { docs, messageSync } from "@collar/yjs_utils.js";
import { WSSharedDoc } from "@collar/ws_share_doc.js";
import log4js from "log4js";
import { persistencePostgresql } from "@storage/storage.js";
import {
  handleYDocUpdate,
  beginYDocUpdateTracking,
  cancelYDocUpdateTracking,
  readYjsUpdatePayload,
} from "@storage/handler/ydoc_action_handler.js";
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

export const closeConn = async (doc: WSSharedDoc, conn: Socket): Promise<void> => {
  if (!doc.conns.has(conn)) return;
  const controlledIds = doc.conns.get(conn);
  doc.conns.delete(conn);
  awarenessProtocol.removeAwarenessStates(
    doc.awareness,
    controlledIds ? Array.from(controlledIds) : [],
    null
  );
  if (doc.conns.size !== 0) return;

  try {
    await cleanupHistoryDocForProject(doc.name);
  } catch (e) {
    logger.error(`failed to clean history state while closing doc=${doc.name}`, e);
  }

  if (persistencePostgresql) {
    try {
      await persistencePostgresql.writeState(doc.name, doc);
    } catch (e) {
      logger.error(`failed to persist state while closing doc=${doc.name}`, e);
    }
  }
  if (doc.conns.size > 0 || docs.get(doc.name) !== doc) return;

  try {
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
          logger.debug(`failed to remove subdoc handler for ${key}: ${e}`);
        }
      });
    }
  } catch (e) {
    logger.debug("error while removing subdoc handlers on closeConn", e);
  }
  doc.destroy();
  docs.delete(doc.name);
  clearSubdocsForRootDoc(doc.name);
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
      await closeConn(doc, conn);
    }
  } catch (e) {
    const decoder = new TextDecoder("utf-8");
    const text = decoder.decode(m);
    logger.error("send message facing error,text:" + text, e);
    await closeConn(doc, conn);
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
      await closeConn(doc, conn);
    }
  } catch (e) {
    const decoder = new TextDecoder("utf-8");
    const text = decoder.decode(msg);
    logger.error("send message facing error,text:" + text, e);
    await closeConn(doc, conn);
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
      await closeConn(doc, conn);
    }
  } catch (e) {
    const decoder = new TextDecoder("utf-8");
    const text = decoder.decode(msg);
    logger.error("send message facing error,text:" + text, e);
    await closeConn(doc, conn);
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

export const emitSyncNack = (
  conn: Socket,
  doc: string,
  seq: number,
  reason: string
) => {
  try {
    conn.emit("sync:nack", { doc, seq, reason });
  } catch (e) {
    logger.error(`emit sync:nack failed for doc=${doc} seq=${seq}`, e);
  }
};

type SyncUpdateMarker = {
  doc: string;
  status: "applied" | "failed";
  reason?: string;
};

type SyncAckState = {
  updates: SyncUpdateMarker[];
  pending: Array<{ doc: string; seq: number }>;
};

const getSyncAckState = (conn: Socket): SyncAckState => {
  const key = "__syncAckState";
  const existing = (conn as any)[key];
  if (existing) return existing as SyncAckState;
  const state: SyncAckState = { updates: [], pending: [] };
  (conn as any)[key] = state;
  return state;
};

const emitSyncMarker = (
  conn: Socket,
  doc: string,
  seq: number,
  marker: SyncUpdateMarker
) => {
  if (marker.status === "failed") {
    emitSyncNack(conn, doc, seq, marker.reason || "apply_failed");
    return;
  }
  emitSyncAck(conn, doc, seq);
};

const addSyncMarker = (
  conn: Socket,
  doc: string,
  marker: SyncUpdateMarker
) => {
  const state = getSyncAckState(conn);
  const pendingIndex = state.pending.findIndex((request) => request.doc === doc);
  if (pendingIndex >= 0) {
    const request = state.pending.splice(pendingIndex, 1)[0];
    emitSyncMarker(conn, request.doc, request.seq, marker);
    return;
  }
  state.updates.push(marker);
};

export const markDocUpdateApplied = (conn: Socket, doc: string) => {
  if (!conn) return;
  addSyncMarker(conn, doc, { doc, status: "applied" });
};

export const markDocUpdateFailed = (
  conn: Socket,
  doc: string,
  reason: string
) => {
  if (!conn) return;
  addSyncMarker(conn, doc, { doc, status: "failed", reason });
};

export const handleSyncAckReq = (conn: Socket, payload: any) => {
  if (!conn) return;
  const doc = payload && payload.doc;
  const seq = payload && payload.seq;
  if (
    typeof doc !== "string" ||
    !doc ||
    typeof seq !== "number" ||
    !Number.isSafeInteger(seq) ||
    seq <= 0
  ) {
    logger.warn("invalid sync:ack_req payload", payload);
    return;
  }
  const syncDocs = (conn as any).__syncDocs as Set<string> | undefined;
  if (syncDocs && !syncDocs.has(doc)) {
    logger.warn("sync:ack_req for unknown document", payload);
    return;
  }
  const state = getSyncAckState(conn);
  const markerIndex = state.updates.findIndex((marker) => marker.doc === doc);
  if (markerIndex >= 0) {
    const marker = state.updates.splice(markerIndex, 1)[0];
    emitSyncMarker(conn, doc, seq, marker);
    return;
  }
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
  message: Uint8Array,
  syncFileAttr?: SyncFileAttr
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
      case SyncMessageType.MessageSync: {
        encoding.writeVarUint(encoder, messageSync);
        const updatePayload = readYjsUpdatePayload(decoder);
        const tracker = persistencePostgresql
          ? beginYDocUpdateTracking(conn, rootDoc)
          : null;
        let syncError: Error | null = null;
        try {
          const syncMessageType = syncProtocol.readSyncMessage(
            decoder,
            encoder,
            rootDoc,
            conn,
            (error: Error) => {
              syncError = error;
            }
          );
          if (syncMessageType === syncProtocol.messageYjsUpdate) {
            let persisted = true;
            if (persistencePostgresql) {
              if (tracker?.observed) {
                persisted = await tracker.promise;
              } else {
                cancelYDocUpdateTracking(conn, tracker);
                if (!updatePayload || !syncFileAttr) {
                  persisted = false;
                } else {
                  persisted = await handleYDocUpdate(
                    updatePayload,
                    rootDoc,
                    syncFileAttr
                  );
                }
              }
            }
            if (syncError === null && persisted) {
              markDocUpdateApplied(conn, rootDoc.name);
            } else {
              markDocUpdateFailed(
                conn,
                rootDoc.name,
                syncError ? "apply_failed" : "persist_failed"
              );
            }
          } else {
            cancelYDocUpdateTracking(conn, tracker);
          }
        } catch (error) {
          cancelYDocUpdateTracking(conn, tracker);
          if (updatePayload) {
            markDocUpdateFailed(conn, rootDoc.name, "apply_failed");
          }
          logger.error("root sync message failed", error);
        }

        if (encoding.length(encoder) > 1) {
          await sendPure(rootDoc, conn, encoding.toUint8Array(encoder));
        }
        break;
      }
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
