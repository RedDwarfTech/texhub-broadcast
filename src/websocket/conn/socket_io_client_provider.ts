// @ts-ignore
import { Observable } from "lib0/observable";
// @ts-ignore
import * as Y from "yjs";
// @ts-ignore
import * as awarenessProtocol from "y-protocols/awareness";
import {
  createEncoder,
  toUint8Array,
  writeVarUint,
  writeVarUint8Array,
  // @ts-ignore
} from "lib0/dist/encoding.cjs";
import {
  createDecoder,
  readVarUint,
  readVarUint8Array,
  // @ts-ignore
} from "lib0/dist/decoding.cjs";
// @ts-ignore
import * as syncProtocol from "y-protocols/sync";
// @ts-ignore
import * as authProtocol from "y-protocols/auth";
// @ts-ignore
import * as url from "lib0/url";
// @ts-ignore
import * as encoding from "lib0/encoding";
// @ts-ignore
import * as bc from "lib0/broadcastchannel";
// @ts-ignore
import * as time from "lib0/time";
import { ManagerOptions, Socket, SocketOptions } from "socket.io-client";
import { WsParam } from "@model/texhub/ws_param.js";
import { MySocket } from "../../types/textypes.js";
import { toJSON } from "flatted";
import { SyncMessageType } from "@model/texhub/sync_msg_type.js";
import { WsCommand } from "@common/ws/WsCommand.js";
import { setupWebsocket } from "./event/setup_ws.js";

export const messageAuth = 2;

const messageHandlers: any[] = [];

messageHandlers[SyncMessageType.MessageSync] = (
  encoder: any,
  decoder: any,
  provider: SocketIOClientProvider,
  emitSynced: any,
  messageType: any
) => {
  writeVarUint(encoder, SyncMessageType.MessageSync);
  const syncMessageType = syncProtocol.readSyncMessage(
    decoder,
    encoder,
    provider.doc,
    provider
  );
  if (
    emitSynced &&
    syncMessageType === syncProtocol.messageYjsSyncStep2 &&
    !provider.synced
  ) {
    provider.synced = true;
  }
};

messageHandlers[SyncMessageType.MessageQueryAwareness] = (
  encoder: any,
  _decoder: any,
  provider: any,
  _emitSynced: any,
  _messageType: any
) => {
  writeVarUint(encoder, SyncMessageType.MessageAwareness);
  writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(
      provider.awareness,
      Array.from(provider.awareness.getStates().keys())
    )
  );
};

messageHandlers[SyncMessageType.MessageAwareness] = (
  _encoder: any,
  decoder: any,
  provider: any,
  _emitSynced: any,
  _messageType: any
) => {
  awarenessProtocol.applyAwarenessUpdate(
    provider.awareness,
    readVarUint8Array(decoder),
    provider
  );
};

messageHandlers[messageAuth] = (
  _encoder: any,
  decoder: any,
  provider: any,
  _emitSynced: any,
  _messageType: any
) => {
  authProtocol.readAuthMessage(decoder, provider.doc, (_ydoc, reason) =>
    permissionDeniedHandler(provider, reason)
  );
};

// @todo - this should depend on awareness.outdatedTime
const messageReconnectTimeout = 30000;

/**
 * @param {WebsocketProvider} provider
 * @param {string} reason
 */
const permissionDeniedHandler = (provider: any, reason: any) =>
  console.warn(`Permission denied to access ${provider.url}.\n${reason}`);

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

/**
 * @param {WebsocketProvider} provider
 * @param {ArrayBuffer} buf
 */
const broadcastMessage = (
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

/**
 * send message without broadcast
 * @param {WebsocketProvider} provider
 * @param {ArrayBuffer} buf
 */
const sendMessage = (provider: SocketIOClientProvider, buf: ArrayBuffer) => {
  const ws = provider.ws;
  if (provider.wsconnected && ws && ws.connected) {
    ws.send(buf);
  }
};

export class SocketIOClientProvider extends Observable<string> {
  maxBackoffTime: number;
  bcChannel: string;
  options?: Partial<ManagerOptions & SocketOptions>;
  url: string;
  roomname: string;
  doc: Y.Doc;
  _WS: WsParam;
  awareness: awarenessProtocol.Awareness;
  wsconnected: boolean;
  wsconnecting: boolean;
  bcconnected: boolean;
  disableBc: boolean;
  wsUnsuccessfulReconnects: number;
  messageHandlers: any;
  synced: boolean;
  ws: Socket | null;
  wsLastMessageReceived: number;
  shouldConnect: boolean;
  _resyncInterval: any;
  bcSubscriber: (data: any, origin: any) => void;
  updateHandler: (update: any, origin: any) => void;
  sendExtMsg: (msg: any) => void;
  _awarenessUpdateHandler: (
    { added, updated, removed }: { added: any; updated: any; removed: any },
    _origin: any
  ) => void;
  _unloadHandler: () => void;
  _checkInterval: NodeJS.Timeout;
  subdocUpdateHandlersMap: any;
  /**
   * manage all sub docs with main doc self
   * @type {Map}
   */
  docs: Map<string, any> = new Map();

  constructor(
    serverUrl: string,
    roomname: string,
    doc: Y.Doc,
    options?: Partial<ManagerOptions & SocketOptions>,
    {
      connect = true,
      awareness = new awarenessProtocol.Awareness(doc),
      params = {},
      SocketPolyfill = MySocket as unknown as WsParam,
      resyncInterval = -1,
      maxBackoffTime = 2500,
      disableBc = false,
    } = {}
  ) {
    super();
    // ensure that url is always ends with /
    while (serverUrl[serverUrl.length - 1] === "/") {
      serverUrl = serverUrl.slice(0, serverUrl.length - 1);
    }
    const encodedParams = url.encodeQueryParams(params);
    this.options = options;
    this.maxBackoffTime = maxBackoffTime;
    this.bcChannel = serverUrl + "/" + roomname;
    this.url =
      serverUrl + (encodedParams.length === 0 ? "" : "?" + encodedParams);
    this.roomname = roomname;
    this.doc = doc;
    this._WS = SocketPolyfill;
    this.awareness = awareness;
    this.wsconnected = false;
    this.wsconnecting = false;
    this.bcconnected = false;
    this.disableBc = disableBc;
    this.wsUnsuccessfulReconnects = 0;
    this.messageHandlers = messageHandlers.slice();
    /**
     * @type {boolean}
     */
    this.synced = false;
    this.ws = null;
    this.wsLastMessageReceived = 0;
    /**
     * Whether to connect to other peers or not
     * @type {boolean}
     */
    this.shouldConnect = connect;
    this.subdocUpdateHandlersMap = new Map();
    this.docs.set(roomname, doc);

    /**
     * @type {number}
     */
    this._resyncInterval = 0;
    if (resyncInterval > 0) {
      this._resyncInterval = /** @type {any} */ setInterval(() => {
        if (this.ws && this.ws.connected) {
          // resend sync step 1
          const encoder = createEncoder();
          writeVarUint(encoder, SyncMessageType.MessageSync);
          syncProtocol.writeSyncStep1(encoder, doc);
          this.ws.send(toUint8Array(encoder));
        }
      }, resyncInterval);
    }

    /**
     * @param {ArrayBuffer} data
     * @param {any} origin
     */
    this.bcSubscriber = (data: ArrayBuffer, origin: any) => {
      if (origin !== this) {
        const encoder = readMessage(this, new Uint8Array(data), false);
        if (encoding.length(encoder) > 1) {
          bc.publish(this.bcChannel, encoding.toUint8Array(encoder), this);
        }
      }
    };

    /**
     * Listens to Yjs updates and sends them to remote peers (ws and broadcastchannel)
     * @param {Uint8Array} update
     * @param {any} origin
     */
    this.updateHandler = (update: Uint8Array, origin: any) => {
      if (origin !== this) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, SyncMessageType.MessageSync);
        syncProtocol.writeUpdate(encoder, update);
        broadcastMessage(this, encoding.toUint8Array(encoder));
      }
    };
    this.doc.on("update", this.updateHandler);

    /**
     * send control message to the server side
     */
    this.sendExtMsg = (msg: WsCommand) => {
      const encoded = new TextEncoder().encode(JSON.stringify(msg));
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, SyncMessageType.MessageControl);
      syncProtocol.writeUpdate(encoder, encoded);
      sendMessage(this, encoding.toUint8Array(encoder));
      let docOpt = {
        guid: msg.fileId,
        collectionid: msg.projectId,
        gc: false,
      };
      let ydoc = new Y.Doc(docOpt);
      console.debug("set the currentdoc to" + msg.fileId);
      this.doc = ydoc;
    };

    /**
     * @param {any} changed
     * @param {any} _origin
     */
    this._awarenessUpdateHandler = (
      {
        added,
        updated,
        removed,
      }: {
        added: Array<number>;
        updated: Array<number>;
        removed: Array<number>;
      },
      _origin: any
    ) => {
      const changedClients = added.concat(updated).concat(removed);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, SyncMessageType.MessageAwareness);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients)
      );
      broadcastMessage(this, encoding.toUint8Array(encoder));
    };
    awareness.on("update", this._awarenessUpdateHandler);
    this._unloadHandler = () => {
      awarenessProtocol.removeAwarenessStates(
        this.awareness,
        [doc.clientID],
        "window unload"
      );
    };
    if (typeof window !== "undefined") {
      window.addEventListener("unload", this._unloadHandler);
    } else if (typeof process !== "undefined") {
      process.on("exit", this._unloadHandler);
    }

    this._checkInterval = /** @type {any} */ setInterval(() => {
      if (
        this.wsconnected &&
        messageReconnectTimeout <
          time.getUnixTime() - this.wsLastMessageReceived
      ) {
        // no message received in a long time - not even your own awareness
        // updates (which are updated every 15 seconds)
        /** @type {WebSocket} */
        //this.ws.close();
      }
    }, messageReconnectTimeout / 10);
    if (connect) {
      this.connect();
    }

    /**
     * Listen to sub documents updates
     * @param {String} id identifier of sub documents
     * @returns
     */
    this.subdocUpdateHandlersMap = (id: string) => {
      return (update: any, origin: any) => {
        if (origin === this) return;
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, SyncMessageType.SubDocMessageSync);
        encoding.writeVarString(encoder, id);
        syncProtocol.writeUpdate(encoder, update);
        broadcastMessage(this, encoding.toUint8Array(encoder));
      };
    };
  }

  /**
   * @param {Y.Doc} subdoc
   */
  removeSubdoc(subdoc: Y.Doc) {
    subdoc.off("update", this.subdocUpdateHandlersMap.get(subdoc.guid));
  }

  /**
   * @param {Y.Doc} subdoc
   */
  addSubdoc(subdoc: Y.Doc) {
    let updateHandler = this.subdocUpdateHandlersMap(subdoc.guid);
    this.docs.set(subdoc.guid, subdoc);
    subdoc.on("update", updateHandler);
    this.subdocUpdateHandlersMap.set(subdoc.guid, updateHandler);

    // invoke sync step1
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, SyncMessageType.MessageSync);
    encoding.writeVarString(encoder, subdoc.guid);
    syncProtocol.writeSyncStep1(encoder, subdoc);
    broadcastMessage(this, encoding.toUint8Array(encoder));
  }

  /**
   * get doc by id (main doc or sub doc)
   * @param {String} id
   * @returns
   */
  getDoc(id: string) {
    return this.docs.get(id);
  }

  connectBc() {
    if (this.disableBc) {
      return;
    }
    if (!this.bcconnected) {
      bc.subscribe(this.bcChannel, this.bcSubscriber);
      this.bcconnected = true;
    }
    // send sync step1 to bc
    // write sync step 1
    const encoderSync = encoding.createEncoder();
    encoding.writeVarUint(encoderSync, SyncMessageType.MessageSync);
    syncProtocol.writeSyncStep1(encoderSync, this.doc);
    bc.publish(this.bcChannel, encoding.toUint8Array(encoderSync), this);
    // broadcast local state
    const encoderState = encoding.createEncoder();
    encoding.writeVarUint(encoderState, SyncMessageType.MessageSync);
    syncProtocol.writeSyncStep2(encoderState, this.doc);
    bc.publish(this.bcChannel, encoding.toUint8Array(encoderState), this);
    // write queryAwareness
    const encoderAwarenessQuery = encoding.createEncoder();
    encoding.writeVarUint(encoderAwarenessQuery, SyncMessageType.MessageQueryAwareness);
    bc.publish(
      this.bcChannel,
      encoding.toUint8Array(encoderAwarenessQuery),
      this
    );
    // broadcast local awareness state
    const encoderAwarenessState = encoding.createEncoder();
    encoding.writeVarUint(encoderAwarenessState,SyncMessageType.MessageAwareness);
    encoding.writeVarUint8Array(
      encoderAwarenessState,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, [
        this.doc.clientID,
      ])
    );
    bc.publish(
      this.bcChannel,
      encoding.toUint8Array(encoderAwarenessState),
      this
    );
  }

  disconnectBc() {
    // broadcast message with local awareness state set to null (indicating disconnect)
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, SyncMessageType.MessageAwareness);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(
        this.awareness,
        [this.doc.clientID],
        new Map()
      )
    );
    broadcastMessage(this, encoding.toUint8Array(encoder));
    if (this.bcconnected) {
      bc.unsubscribe(this.bcChannel, this.bcSubscriber);
      this.bcconnected = false;
    }
  }

  disconnect() {
    this.shouldConnect = false;
    this.disconnectBc();
    if (this.ws !== null && this.ws) {
      this.ws.disconnect();
    }
  }

  connect() {
    this.shouldConnect = true;
    if (!this.wsconnected || this.ws === null || this.ws === undefined) {
      setupWebsocket(this);
      this.connectBc();
    }
  }
}
