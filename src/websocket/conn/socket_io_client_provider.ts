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
  // @ts-ignore
} from "lib0/encoding";
// @ts-ignore
import * as syncProtocol from "y-protocols/sync";
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
import { TeXSocket } from "@texhub/client/tex_socket.js";
import { SyncMessageType } from "@model/texhub/sync_msg_type.js";
import { WsCommand } from "@common/ws/WsCommand.js";
import { setupWebsocket } from "./event/client/cleint_setup_ws.js";
import { messageHandlers } from "./event/client/client_msg_type_handler.js";
import { broadcastMessage, readMessage } from "./action/ws_action.js";
import { SyncMessageContext } from "@/model/texhub/sync_msg_context.js";
import { v4 as uuidv4 } from "uuid";
import { enableDebug } from "@/common/log_util_web.js";
import { UpdateOrigin } from "@/model/yjs/net/update_origin.js";
import { outbox, OutboxEntryType } from "@/common/outbox/outbox.js";

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
        syncProtocol.writeUpdate(encoder, update);
        this.sendWithOutbox(
          this.roomname,
          update,
          "root",
          encoding.toUint8Array(encoder),
          true
        );
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
        const seq = this.nextSeq(id);
        let msg: SyncMessageContext = {
          doc_name: id,
          src: "subdocUpdateHandler",
          trace_id: uniqueValue,
          seq: seq,
        };
        let msgStr = JSON.stringify(msg);
        encoding.writeVarString(encoder, msgStr);
        syncProtocol.writeUpdate(encoder, update);
        this.sendWithOutbox(id, update, "subdoc", encoding.toUint8Array(encoder), false, seq);
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
    // 先解绑旧的 handler，避免重复绑定
    const oldHandler = this.subdocUpdateHandlersMap.get(subdoc.guid);
    if (oldHandler) {
      // @ts-ignore
      subdoc.off("update", oldHandler);
      console.log(`[addSubdoc] 移除旧 handler: guid=${subdoc.guid}`);
    }

    // 新的 update handler
    const newHandler = (update: any, origin: any) => {
      console.log(
        `[subdoc update] guid=${subdoc.guid}, origin=`,
        origin,
        ", update=",
        update
      );
      if (origin === this) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, SyncMessageType.SubDocMessageSync);
      const uniqueValue = uuidv4();
      const seq = this.nextSeq(subdoc.guid);
      let msg: SyncMessageContext = {
        doc_name: subdoc.guid,
        src: "subdocUpdateHandler",
        trace_id: uniqueValue,
        seq: seq,
      };
      let msgStr = JSON.stringify(msg);
      encoding.writeVarString(encoder, msgStr);
      syncProtocol.writeUpdate(encoder, update);
      this.sendWithOutbox(
        subdoc.guid,
        update,
        "subdoc",
        encoding.toUint8Array(encoder),
        false,
        seq
      );
      console.log(
        `[subdoc update] handler已广播: guid=${subdoc.guid}, trace_id=${uniqueValue}, seq=${seq}`
      );
    };
    // 注册新的 handler
    // @ts-ignore
    subdoc.on("update", newHandler);
    this.subdocUpdateHandlersMap.set(subdoc.guid, newHandler);
    this.docs.set(subdoc.guid, subdoc);
    console.log(`[addSubdoc] 注册新 handler: guid=${subdoc.guid}`);

    // invoke sync step1
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, SyncMessageType.SubDocMessageSync);
    const uniqueValue = uuidv4();
    let msg: SyncMessageContext = {
      doc_name: subdoc.guid,
      src: "addSubdoc",
      trace_id: uniqueValue,
      msg_type: "sync_step_1",
    };
    let msgStr = JSON.stringify(msg);
    encoding.writeVarString(encoder, msgStr);
    syncProtocol.writeSyncStep1(encoder, subdoc);
    broadcastMessage(this, encoding.toUint8Array(encoder));
    console.log(
      `[addSubdoc] sync step1已广播: guid=${subdoc.guid}, trace_id=${uniqueValue}`
    );
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

  /**
   * P0 Outbox：为 doc 分配下一个单调 seq（IndexedDB 持久化，跨会话不重置）。
   */
  nextSeq(doc: string): number {
    return outbox.nextSeq(doc);
  }

  /**
   * P0 Outbox：把本地产生的 Yjs update 先入 Outbox，再走原 broadcastMessage 发送链路。
   * root 类型（MessageSync 帧不含上下文）额外发 `sync:ack_req` 请求回执；
   * subdoc 类型已把 seq 内嵌进帧上下文，由服务端应用成功后直接回 `sync:ack`。
   */
  sendWithOutbox(
    docName: string,
    update: Uint8Array,
    type: OutboxEntryType,
    frame: Uint8Array,
    askAck: boolean,
    seq?: number
  ) {
    const outboxSeq = seq ?? this.nextSeq(docName);
    outbox
      .enqueue({ doc: docName, seq: outboxSeq, type, update })
      .catch((e) => console.error("outbox enqueue failed", e));
    // 原发送链路（ws 连接时直连发送 + 跨标签页 bc 广播）
    broadcastMessage(this, frame);
    if (askAck && this.wsconnected && this.ws && this.ws.connected) {
      this.ws.emit("sync:ack_req", { doc: docName, seq: outboxSeq });
    }
  }

  /**
   * 处理服务端 `sync:ack { doc, seq }`：从 Outbox 删除已确认条目。
   */
  handleSyncAck(payload: any) {
    const doc = payload && payload.doc;
    const seq = payload && payload.seq;
    if (!doc || typeof seq !== "number") return;
    outbox
      .ack(doc, seq)
      .catch((e) => console.error("outbox ack failed", e));
  }

  /**
   * 重连时重放 Outbox 中未确认的 update（保证服务端拿到最新），再交由调用方发起
   * sync step1 对账。重放帧与原始帧完全一致（含原始 seq），服务端幂等消费安全。
   */
  async replayOutbox(socketio: Socket): Promise<void> {
    await outbox.init().catch(() => {});
    const entries = outbox.getUnacked();
    if (entries.length === 0) return;
    for (const entry of entries) {
      try {
        let frame: Uint8Array;
        if (entry.type === "subdoc") {
          frame = this.buildSubdocUpdateFrame(entry.doc, entry.update, entry.seq);
        } else {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, SyncMessageType.MessageSync);
          syncProtocol.writeUpdate(encoder, entry.update);
          frame = encoding.toUint8Array(encoder);
        }
        socketio.send(frame);
        if (entry.type === "root") {
          socketio.emit("sync:ack_req", { doc: entry.doc, seq: entry.seq });
        }
      } catch (e) {
        console.error(
          `replay outbox entry failed doc=${entry.doc} seq=${entry.seq}`,
          e
        );
      }
    }
  }

  /** 构造 subdoc update 帧（与实时发送完全一致，供 Outbox 重放复用）。 */
  buildSubdocUpdateFrame(
    docName: string,
    update: Uint8Array,
    seq: number
  ): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, SyncMessageType.SubDocMessageSync);
    const uniqueValue = uuidv4();
    let msg: SyncMessageContext = {
      doc_name: docName,
      src: "outboxReplay",
      trace_id: uniqueValue,
      seq: seq,
    };
    let msgStr = JSON.stringify(msg);
    encoding.writeVarString(encoder, msgStr);
    syncProtocol.writeUpdate(encoder, update);
    return encoding.toUint8Array(encoder);
  }

  connect() {
    this.shouldConnect = true;
    if (!this.wsconnected || this.ws === null || this.ws === undefined) {
      setupWebsocket(this);
      this.connectBc();
    }
  }
}
