import { SocketIOClientProvider } from "../../socket_io_client_provider.js";
import { Socket } from "socket.io-client";
import logger from "@common/log4js_config.js";
// @ts-ignore
import { math } from "rdlib0";
// @ts-ignore
import * as time from "rdlib0/time";
// @ts-ignore
import * as encoding from "rdlib0/encoding";
// @ts-ignore
import * as awarenessProtocol from "rdy-protocols/awareness";
import { SyncMessageType } from "@model/texhub/sync_msg_type.js";
// @ts-ignore
import * as syncProtocol from "rdy-protocols/sync";
import { readMessage } from "../../action/ws_action.js";
import { SyncMessageContext } from "@/model/texhub/sync_msg_context.js";
import { v4 as uuidv4 } from "uuid";
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
      provider.wsLastMessageReceived = time.getUnixTime();
      const encoder = readMessage(provider, new Uint8Array(data), true);
      if (encoding.length(encoder) > 1) {
        socketio.send(encoding.toUint8Array(encoder));
      }
      //provider.emit("message", [data, provider]);
    });
    // additional lifecycle listeners to help debug disconnect reasons
    socketio.on("disconnect", (reason: any) => {
      try {
        logger.info(
          `[client disconnect] id=${socketio.id}, reason=${String(reason)}, wsconnected=${provider.wsconnected}, room=${provider.roomname}`
        );
        // debug handshake if available
        try {
          // @ts-ignore
          logger.debug(`handshake=${JSON.stringify((socketio as any).io && (socketio as any).io.engine ? (socketio as any).io.engine.transport : {}, null, 2)}`);
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
      //provider.emit("connection-close", [event, provider]);
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
        //provider.emit("status", [
        //  {
        //    status: "disconnected",
        //  },
        //]);
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
    socketio.on("connect", () => {
      provider.wsLastMessageReceived = time.getUnixTime();
      provider.wsconnecting = false;
      provider.wsconnected = true;
      provider.wsUnsuccessfulReconnects = 0;
      localStorage.setItem("socket-id", socketio.id || "");
      //provider.emit("status", [
      // {
      //   status: "connected",
      // },
      //]);
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
