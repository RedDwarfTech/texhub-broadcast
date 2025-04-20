import { SocketIOClientProvider } from "./socket_io_client_provider";
// @ts-ignore
import * as Y from "rdyjs";
import { ManagerOptions, SocketOptions } from "socket.io-client";
import { WsParam } from "@model/texhub/ws_param.js";

class SingleClientProvider {
  private static instance: SocketIOClientProvider | null = null;
  private static isInitialized = false;
  private static currentRoom: string | null = null;

  static getInstance(
    serverUrl: string,
    roomname: string,
    doc: Y.Doc,
    enableSubDoc?: boolean,
    options?: Partial<ManagerOptions & SocketOptions>,
    config?: {
      connect?: boolean;
      awareness?: any;
      params?: any;
      SocketPolyfill?: WsParam;
      resyncInterval?: number;
      maxBackoffTime?: number;
      disableBc?: boolean;
    }
  ): SocketIOClientProvider {
    if (!SingleClientProvider.instance) {
      if (SingleClientProvider.isInitialized) {
        throw new Error("SingleClientProvider has been destroyed and cannot be reinitialized");
      }
      SingleClientProvider.instance = new SocketIOClientProvider(
        serverUrl,
        roomname,
        doc,
        enableSubDoc,
        options,
        config
      );
      SingleClientProvider.currentRoom = roomname;
      SingleClientProvider.isInitialized = true;
    }
    return SingleClientProvider.instance;
  }

  static destroy(): void {
    if (SingleClientProvider.instance) {
      SingleClientProvider.instance.disconnect();
      SingleClientProvider.instance = null;
      SingleClientProvider.isInitialized = false;
      SingleClientProvider.currentRoom = null;
    }
  }

  static isConnected(): boolean {
    return SingleClientProvider.instance?.wsconnected ?? false;
  }

  static getCurrentRoom(): string | null {
    return SingleClientProvider.currentRoom;
  }
}

export default SingleClientProvider;



