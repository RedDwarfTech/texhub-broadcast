// @ts-ignore
import * as awarenessProtocol from "rdy-protocols/dist/awareness.mjs";
import { docs, messageSync } from "@collar/yjs_utils.js";
import { WSSharedDoc } from "@collar/ws_share_doc.js";
import log4js from "log4js";
import { persistencePostgresql } from "@storage/storage.js";
import { Socket } from "socket.io";
var logger = log4js.getLogger();
// @ts-ignore
import * as encoding from "rdlib0/dist/encoding.mjs";
// @ts-ignore
import * as decoding from "rdlib0/dist/decoding.mjs";
// @ts-ignore
import * as bc from "rdlib0/broadcastchannel";
import {
  createEncoder,
  toUint8Array,
  writeVarUint,
  // @ts-ignore
} from "rdlib0/dist/encoding.mjs";
// @ts-ignore
import * as syncProtocol from "rdy-protocols/dist/sync.mjs";
import { SyncMessageType } from "@model/texhub/sync_msg_type.js";
import { getTexFileInfo } from "@storage/appfile.js";
import { handleControlSignals } from "../event/server/app_control_handler.js";
import { handleSubDocMsg } from "../event/server/subdoc_msg_handler.js";
import { SocketIOClientProvider } from "../socket_io_client_provider.js";
import {
  createDecoder,
  readVarUint,
  // @ts-ignore
} from "rdlib0/dist/decoding.mjs";

/**
 * send message without broadcast
 * @param {WebsocketProvider} provider
 * @param {ArrayBuffer} buf
 */
export const sendMessage = (provider: SocketIOClientProvider, buf: ArrayBuffer) => {
  const ws = provider.ws;
  if (provider.wsconnected && ws && ws.connected) {
    ws.send(buf);
  }
};

/**
 * @param {WebsocketProvider} provider
 * @param {ArrayBuffer} buf
 */
export const broadcastMessage = (
  provider: SocketIOClientProvider,
  buf: ArrayBuffer
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

export const send = async (doc: WSSharedDoc, conn: Socket, msg: Uint8Array) => {
  try {
    if (conn.connected) {
      // https://stackoverflow.com/questions/16518153/get-connection-status-on-socket-io-client
      conn.send(msg);
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
    const text = decoder.decode(msg);
    logger.error("send message facing error,text:" + text, e);
    closeConn(doc, conn);
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
        /**
         * https://github.com/yjs/y-websocket/issues/81
         */
        await handleSubDocMsg(rootDoc, conn, decoder);
        break;
      case SyncMessageType.MessageSync:
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.readSyncMessage(decoder, encoder, rootDoc, conn);

        // If the `encoder` only contains the type of reply message and no
        // message, there is no need to send the message. When `encoder` only
        // contains the type of reply, its length is 1.
        if (encoding.length(encoder) > 1) {
          send(rootDoc, conn, encoding.toUint8Array(encoder));
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
