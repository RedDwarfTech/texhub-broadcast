// @ts-ignore
import { Observable } from "rdlib0/observable";
// @ts-ignore
import * as Y from "rdyjs";
// @ts-ignore
import * as awarenessProtocol from "rdy-protocols/awareness";
import {
  createEncoder,
  toUint8Array,
  writeVarUint,
  // @ts-ignore
} from "rdlib0/dist/encoding.mjs";
// @ts-ignore
import * as syncProtocol from "rdy-protocols/sync";
// @ts-ignore
import * as url from "rdlib0/url";
// @ts-ignore
import * as encoding from "rdlib0/encoding";
// @ts-ignore
import * as bc from "rdlib0/broadcastchannel";
// @ts-ignore
import * as time from "rdlib0/time";
import { ManagerOptions, Socket, SocketOptions } from "socket.io-client";
import { WsParam } from "@model/texhub/ws_param.js";
import { TeXSocket } from "@texhub/client/tex_socket.js";
import { SyncMessageType } from "@model/texhub/sync_msg_type.js";
import { WsCommand } from "@common/ws/WsCommand.js";
import { setupWebsocket } from "./event/setup_ws.js";
import { messageHandlers } from "./event/msg_type_handler.js";
import { broadcastMessage, readMessage, sendMessage } from "./ws_action.js";
import { SyncMessageContext } from "@/model/texhub/sync_msg_context.js";
import { v4 as uuidv4 } from "uuid";
import { enableDebug } from "@/common/log_util_web.js";
import { UpdateOrigin } from "@/model/yjs/net/update_origin.js";

// @todo - this should depend on awareness.outdatedTime
const messageReconnectTimeout = 30000;

type YDocUpdateHandler = (update: any, origin: any) => void;

type UpdateHandlerFactory = (id: string) => YDocUpdateHandler;

export class SocketIOClientProvider extends Observable<string> {
  private static instanceCount = 0;
  public readonly instanceId: number;
  maxBackoffTime: number;
  bcChannel: string;
  options?: Partial<ManagerOptions & SocketOptions>;
  url: string;
  roomname: string;
  enableSubDoc?: boolean;
  doc: Y.Doc;
  _WS: WsParam;
  awareness: awarenessProtocol.Awareness;
  wsconnected: boolean;
  wsconnecting: boolean;
  bcconnected: boolean;
  disableBc: boolean;
  wsUnsuccessfulReconnects: number;
  messageHandlers: any;
  _synced: boolean;
  ws: Socket | null;
  wsLastMessageReceived: number;
  shouldConnect: boolean;
  _resyncInterval: any;
  bcSubscriber: (data: any, origin: any) => void;
  _awarenessUpdateHandler: (
    { added, updated, removed }: { added: any; updated: any; removed: any },
    _origin: any
  ) => void;
  _unloadHandler: () => void;
  _checkInterval: NodeJS.Timeout;
  subdocUpdateHandlersMap: Map<string, YDocUpdateHandler>;
  subdocUpdateHandler: UpdateHandlerFactory;
  updateHandler: (update: any, origin: any) => void;
  /**
   * manage all sub docs with main doc self
   * @type {Map}
   */
  docs: Map<string, Y.Doc> = new Map();
  /**
   * store synced status for sub docs
   */
  syncedStatus = new Map();

  constructor(
    serverUrl: string,
    roomname: string,
    doc: Y.Doc,
    enableSubDoc?: boolean,
    options?: Partial<ManagerOptions & SocketOptions>,
    {
      connect = true,
      awareness = new awarenessProtocol.Awareness(doc),
      params = {},
      SocketPolyfill = TeXSocket as unknown as WsParam,
      resyncInterval = -1,
      maxBackoffTime = 2500,
      disableBc = false,
    } = {}
  ) {
    super();
    this.instanceId = SocketIOClientProvider.instanceCount++;
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
    this.enableSubDoc = enableSubDoc;
    this.disableBc = disableBc;
    this.wsUnsuccessfulReconnects = 0;
    this.messageHandlers = messageHandlers.slice();
    /**
     * @type {boolean}
     */
    this._synced = false;
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
        if (enableDebug()) {
          console.log("trigger updateHandler");
          const tempDoc = new Y.Doc();
          let uo: UpdateOrigin = {
            name: "updateHandler-debug",
            origin: "client",
          };
          Y.applyUpdate(tempDoc, update, uo);
          for (const key of tempDoc.share.keys()) {
            const txt = tempDoc.getText(key).toString();
            console.log(`update内容: text[${key}] =`, txt);
          }
        }
        syncProtocol.writeUpdate(encoder, update);
        broadcastMessage(this, encoding.toUint8Array(encoder));
      }
    };
    // @ts-ignore
    this.doc.on("update", this.updateHandler);

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
    this.subdocUpdateHandler = (id: string) => {
      let result = (update: any, origin: any) => {
        console.log("trigger subdocUpdateHandler");
        if (origin === this) return;
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, SyncMessageType.SubDocMessageSync);
        const uniqueValue = uuidv4();
        let msg: SyncMessageContext = {
          doc_name: id,
          src: "subdocUpdateHandler",
          trace_id: uniqueValue,
        };
        let msgStr = JSON.stringify(msg);
        encoding.writeVarString(encoder, msgStr);
        syncProtocol.writeUpdate(encoder, update);
        broadcastMessage(this, encoding.toUint8Array(encoder));
      };
      return result;
    };
  }

  updateSyncedStatus(id: string, state: any) {
    const oldState = this.syncedStatus.get(id);
    if (oldState !== state) {
      this.syncedStatus.set(id, state);
      // @ts-ignore
      this.emit("subdoc_synced", [id, state]);
    }
  }

  /**
   * @param {Y.Doc} subdoc
   */
  removeSubdoc(subdoc: Y.Doc) {
    console.log("trigger remove subdoc" + subdoc.guid);
    // @ts-ignore
    subdoc.off("update", this.subdocUpdateHandlersMap.get(subdoc.guid));
  }

  /**
   * @param {Y.Doc} subdoc
   */
  addSubdoc(subdoc: Y.Doc) {
    if (!subdoc.guid) {
      console.error("Subdoc guid is missing!");
      return;
    }
    //let subDocUpdateHandler = this.subdocUpdateHandler(subdoc.guid);
    const subdocUpdateHandler = (id: string) => {
      let result = (update: any, origin: any) => {
        console.log("trigger 2222subdocUpdateHandler:" + id);
        if (origin === this) return;
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, SyncMessageType.SubDocMessageSync);
        const uniqueValue = uuidv4();
        let msg: SyncMessageContext = {
          doc_name: id,
          src: "subdocUpdateHandler",
          trace_id: uniqueValue,
        };
        let msgStr = JSON.stringify(msg);
        encoding.writeVarString(encoder, msgStr);
        syncProtocol.writeUpdate(encoder, update);
        broadcastMessage(this, encoding.toUint8Array(encoder));
      };
      return result;
    };
    // @ts-ignore
    //subdoc.on("update", subdocUpdateHandler(subdoc.guid));
    subdoc.on("update", (update, origin) => {
      console.log("subdoc update event triggered, guid:", subdoc.guid);
    });
    this.subdocUpdateHandlersMap.set(subdoc.guid, subdocUpdateHandler);
    this.docs.set(subdoc.guid, subdoc);

    // invoke sync step1
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, SyncMessageType.SubDocMessageSync);
    const uniqueValue = uuidv4();
    let msg: SyncMessageContext = {
      doc_name: subdoc.guid,
      src: "addSubdoc",
      trace_id: uniqueValue,
    };
    let msgStr = JSON.stringify(msg);
    encoding.writeVarString(encoder, msgStr);
    syncProtocol.writeSyncStep1(encoder, subdoc);
    broadcastMessage(this, encoding.toUint8Array(encoder));
  }

  /**
   * get doc by id (main doc or sub doc)
   * @param {String} id
   * @returns
   */
  getDoc(id: string) {
    console.log("Getting doc with id:", id);
    console.log(
      "Current docs state in getDoc:",
      Array.from(this.docs.entries())
    );
    const doc = this.docs.get(id);
    if (!doc) {
      console.error("Document not found for id:", id);
    }
    return doc;
  }

  /**
   * @type {boolean}
   */
  get synced() {
    return this._synced;
  }

  set synced(state) {
    if (this._synced !== state) {
      this._synced = state;
      // @ts-ignore
      this.emit("synced", [state]);
      // @ts-ignore
      this.emit("sync", [state]);
    }
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
    encoding.writeVarUint(
      encoderAwarenessQuery,
      SyncMessageType.MessageQueryAwareness
    );
    bc.publish(
      this.bcChannel,
      encoding.toUint8Array(encoderAwarenessQuery),
      this
    );
    // broadcast local awareness state
    const encoderAwarenessState = encoding.createEncoder();
    encoding.writeVarUint(
      encoderAwarenessState,
      SyncMessageType.MessageAwareness
    );
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
