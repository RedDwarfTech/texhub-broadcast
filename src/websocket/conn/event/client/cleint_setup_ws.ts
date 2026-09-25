import { SocketIOClientProvider } from "../../socket_io_client_provider.js";
import { Socket } from "socket.io-client";
import logger from "@common/log4js_config.js";
// @ts-ignore
import { math } from "lib0";
// @ts-ignore
import * as encoding from "lib0/encoding";
// @ts-ignore
import * as awarenessProtocol from "y-protocols/awareness";
import { SyncMessageType } from "@model/texhub/sync_msg_type.js";
// @ts-ignore
import * as syncProtocol from "y-protocols/sync";
import { readMessage } from "../../action/ws_action.js";
import { handleSubdocConnect } from "./subdoc_connect_handler.js";
/**
 * @param {SocketIOClientProvider} provider
 */
export const setupWebsocket = (provider: SocketIOClientProvider) => {
  if (provider.shouldConnect && provider.ws === null) {
    const socketio: Socket = new provider._WS(provider.url, provider.options);
    provider.ws = socketio;
    provider.wsconnecting = true;
    provider.wsconnected = false;
    provider._synced = false;

    socketio.on("message", (data) => {
      provider.markMessageReceived();
      const encoder = readMessage(provider, new Uint8Array(data), true);
      if (encoding.length(encoder) > 1) {
        socketio.send(encoding.toUint8Array(encoder));
      }
      //provider.emit("message", [data, provider]);
    });
    // P1（docs/design/message-reliable.md §6.2）：服务端探活回执秒回，据此刷新
    // 活跃度，使在线但闲置的连接免于被僵尸检测误杀。
    socketio.on("probe_ack", () => {
      provider.markMessageReceived();
    });
    // P1（docs/design/message-reliable.md §6.3）：握手下发的 serverEpoch，
    // 对比本地缓存判定服务器是否重启，重启则强制完整对账。
    socketio.on("sync:epoch", (payload: any) => {
      provider.handleServerEpoch(payload);
    });
    // P0：服务端 Outbox ACK（server -> client），确认后从 Outbox 删除对应条目
    socketio.on("sync:ack", (payload: any) => {
      provider.handleSyncAck(payload);
    });
    // additional lifecycle listeners to help debug disconnect reasons
    socketio.on("disconnect", (reason: any) => {
      try {
        logger.info(
          `[client disconnect] id=${socketio.id}, reason=${String(
            reason
          )}, wsconnected=${provider.wsconnected}, room=${provider.roomname}`
        );
        // debug handshake if available
        try {
          // @ts-ignore
          logger.debug(
            `handshake=${JSON.stringify(
              (socketio as any).io && (socketio as any).io.engine
                ? (socketio as any).io.engine.transport
                : {},
              null,
              2
            )}`
          );
        } catch (e) {}
      } catch (e) {
        console.warn("error logging disconnect", e);
      }
      // mirror close behaviour: mark disconnected and reset synced flag
      provider.ws = null;
      provider.wsconnecting = false;
      if (provider.wsconnected) {
        provider.wsconnected = false;
        provider._synced = false;
        awarenessProtocol.removeAwarenessStates(
          provider.awareness,
          Array.from(provider.awareness.getStates().keys()).filter(
            (client) => client !== provider.doc.clientID
          ),
          provider
        );
      } else {
        provider.wsUnsuccessfulReconnects++;
      }
    });
    socketio.on("error", (err) => {
      logger.error("socket error", err);
    });
    socketio.on("connect_error", (err) => {
      logger.warn("socket connect_error", err);
    });
    socketio.on("error", (event) => {
      console.log("error received");
      //provider.emit("connection-error", [event, provider]);
    });
    socketio.on("close", (event) => {
      // @ts-ignore
      provider.emit("connection-close", [event, provider]);
      provider.ws = null;
      provider.wsconnecting = false;
      if (provider.wsconnected) {
        provider.wsconnected = false;
        provider._synced = false;
        // update awareness (all users except local left)
        awarenessProtocol.removeAwarenessStates(
          provider.awareness,
          Array.from(provider.awareness.getStates().keys()).filter(
            (client) => client !== provider.doc.clientID
          ),
          provider
        );
        // @ts-ignore
        provider.emit("status", [
          {
            status: "disconnected",
          },
        ]);
      } else {
        provider.wsUnsuccessfulReconnects++;
      }

      // Start with no reconnect timeout and increase timeout by
      // using exponential backoff starting with 100ms
      setTimeout(
        setupWebsocket,
        math.min(
          math.pow(2, provider.wsUnsuccessfulReconnects) * 100,
          provider.maxBackoffTime
        ),
        provider
      );
    });
    socketio.on("connect", async () => {
      provider.markMessageReceived();
      provider.wsconnecting = false;
      provider.wsconnected = true;
      provider.ws = socketio;
      provider.wsUnsuccessfulReconnects = 0;
      localStorage.setItem("socket-id", socketio.id || "");
      // @ts-ignore
      provider.emit("status", [
        {
          status: "connected",
        },
      ]);
      // P0：先重放 Outbox 中未确认的 update（保证服务端拿到断线期间的本地编辑），
      // 再发 sync step1 对账。重放与对账都幂等，顺序安全。
      try {
        await provider.replayOutbox(socketio);
      } catch (e) {
        logger.warn("replay outbox before sync failed", e);
      }
      if (provider.enableSubDoc) {
        handleSubdocConnect(provider, socketio);
      } else {
        // always send sync step 1 when connected
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, SyncMessageType.MessageSync);
        syncProtocol.writeSyncStep1(encoder, provider.doc);
        socketio.send(encoding.toUint8Array(encoder));
      }
      // broadcast local awareness state
      if (provider.awareness.getLocalState() !== null) {
        const encoderAwarenessState = encoding.createEncoder();
        encoding.writeVarUint(
          encoderAwarenessState,
          SyncMessageType.MessageAwareness
        );
        encoding.writeVarUint8Array(
          encoderAwarenessState,
          awarenessProtocol.encodeAwarenessUpdate(provider.awareness, [
            provider.doc.clientID,
          ])
        );
        socketio.send(encoding.toUint8Array(encoderAwarenessState));
      }
    });
    //provider.emit("status", [
    //   {
    //    status: "connecting",
    // },
    //]);
  }
};
