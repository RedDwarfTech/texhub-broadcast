import {
  readMessage,
  SocketIOClientProvider,
} from "../socket_io_client_provider.js";
import { ManagerOptions, Socket, SocketOptions } from "socket.io-client";
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

/**
 * @param {SocketIOClientProvider} provider
 */
export const setupWebsocket = (provider: SocketIOClientProvider) => {
  
  console.log("setupWebsocket called:", provider);
  if (provider.shouldConnect && provider.ws === null) {
    debugger;
    const websocket: Socket = new provider._WS(provider.url, provider.options);
    provider.ws = websocket;
    provider.wsconnecting = true;
    provider.wsconnected = false;
    provider._synced = false;

    websocket.on("message", (data) => {
      console.log("message received");
      provider.wsLastMessageReceived = time.getUnixTime();
      const encoder = readMessage(provider, new Uint8Array(data), true);
      if (encoding.length(encoder) > 1) {
        websocket.send(encoding.toUint8Array(encoder));
      }
      //provider.emit("message", [data, provider]);
    });
    websocket.on("error", (event) => {
      console.log("error received");
      //provider.emit("connection-error", [event, provider]);
    });
    websocket.on("close", (event) => {
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
    websocket.on("connect", () => {
      provider.wsLastMessageReceived = time.getUnixTime();
      provider.wsconnecting = false;
      provider.wsconnected = true;
      provider.wsUnsuccessfulReconnects = 0;
      //provider.emit("status", [
      // {
      //   status: "connected",
      // },
      //]);
      if (provider.enableSubDoc) {
        for (const [k, doc] of provider.docs) {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, SyncMessageType.SubDocMessageSync);
          encoding.writeVarString(encoder, k);
          syncProtocol.writeSyncStep1(encoder, doc);
          websocket.send(encoding.toUint8Array(encoder));
        }
      } else {
        // always send sync step 1 when connected
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, SyncMessageType.MessageSync);
        syncProtocol.writeSyncStep1(encoder, provider.doc);
        websocket.send(encoding.toUint8Array(encoder));
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
        websocket.send(encoding.toUint8Array(encoderAwarenessState));
      }
    });
    //provider.emit("status", [
    //   {
    //    status: "connecting",
    // },
    //]);
  }
};
