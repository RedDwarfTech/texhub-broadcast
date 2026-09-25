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
const syncAckTimeout = 10000;
const syncMaxRetries = 3;
const syncRetryBaseDelayMs = 1000;
const syncRetryMaxDelayMs = 30000;

type SyncStatusPayload = {
  doc: string;
  seq: number;
  state: "pending" | "synced" | "failed";
  pending: number;
  reason?: string;
};

type YDocUpdateHandler = (update: any, origin: any) => void;
type OutboxFrame = Uint8Array | ((seq: number) => Uint8Array);
type DeferredOutboxEnqueue = {
  docName: string;
  update: Uint8Array;
  type: OutboxEntryType;
  frame: OutboxFrame;
  askAck: boolean;
  seq?: number;
};

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
  // P1 §6.2：僵尸连接探测状态
  _staleProbePendingAt: number;
  _staleProbeAcked: boolean;
  // P1 §6.3：会话一致性 serverEpoch
  serverEpoch: number | null;
  serverEpochChanged: boolean;
  shouldConnect: boolean;
  _resyncInterval: any;
  bcSubscriber: (data: any, origin: any) => void;
  _awarenessUpdateHandler: (
    { added, updated, removed }: { added: any; updated: any; removed: any },
    _origin: any
  ) => void;
  _unloadHandler: () => void;
  _checkInterval: NodeJS.Timeout;
  private outboxSendTail: Promise<void>;
  private ackTimers: Map<string, ReturnType<typeof setTimeout>>;
  private ackRetryTimers: Map<string, ReturnType<typeof setTimeout>>;
  private ackAttempts: Map<string, number>;
  private outboxEnqueueTimers: Map<string, ReturnType<typeof setTimeout>>;
  private outboxEnqueueAttempts: Map<string, number>;
  private outboxEnqueueDeferred: Map<string, DeferredOutboxEnqueue>;
  private outboxEnqueueDeferredTimer: ReturnType<typeof setTimeout> | null;
  private outboxEnqueueId: number;
  private outboxRefreshTimer: ReturnType<typeof setTimeout> | null;
  private outboxRefreshAttempts: number;
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
    this.outboxSendTail = Promise.resolve();
    this.ackTimers = new Map();
    this.ackRetryTimers = new Map();
    this.ackAttempts = new Map();
    this.outboxEnqueueTimers = new Map();
    this.outboxEnqueueAttempts = new Map();
    this.outboxEnqueueDeferred = new Map();
    this.outboxEnqueueDeferredTimer = null;
    this.outboxEnqueueId = 0;
    this.outboxRefreshTimer = null;
    this.outboxRefreshAttempts = 0;
    /**
     * @type {boolean}
     */
    this._synced = false;
    this.ws = null;
    this.wsLastMessageReceived = 0;
    // P1（docs/design/message-reliable.md §6.3）：会话一致性 serverEpoch。
    // 记录最近一次握手下发的 serverEpoch；若与本地缓存不一致，说明服务器重启，
    // 内存态 Yjs doc / 房间成员 / Outbox 确认态全部失效，需完整对账。
    this.serverEpoch = null;
    this.serverEpochChanged = false;
    // P1（docs/design/message-reliable.md §6.2）：僵尸连接治理状态。
    // 连接超过 messageReconnectTimeout 无任何消息时进入 stale 窗口，先发探活
    // probe 二次确认（避免误杀"在线但闲置"的连接），probe_ack 仍未收到才强制
    // close 触发重连。
    this._staleProbePendingAt = 0;
    this._staleProbeAcked = true;
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
        // updates (which are updated every 15 seconds).
        // P1（docs/design/message-reliable.md §6.2）：不再直接 close，先探活，
        // 剔除真正的僵尸连接（网络黑洞/CPU 卡死），闲置但存活连接会收到 probe_ack
        // 刷新 wsLastMessageReceived 而不会误杀。
        this._staleProbeTick();
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
      let result = async (update: any, origin: any) => {
        console.log("trigger subdocUpdateHandler");
        if (origin === this) return;
        const frame = (seq: number) =>
          this.buildSubdocUpdateFrame(id, update, seq, "subdocUpdateHandler");
        await this.sendWithOutbox(id, update, "subdoc", frame, false);
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
    const newHandler = async (update: any, origin: any) => {
      console.log(
        `[subdoc update] guid=${subdoc.guid}, origin=`,
        origin,
        ", update=",
        update
      );
      if (origin === this) return;
      const frame = (seq: number) =>
        this.buildSubdocUpdateFrame(
          subdoc.guid,
          update,
          seq,
          "subdocUpdateHandler"
        );
      await this.sendWithOutbox(subdoc.guid, update, "subdoc", frame, false);
      console.log(`[subdoc update] handler已提交: guid=${subdoc.guid}`);
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
    if (this.wsconnected && this.ws?.connected) {
      void this.replayOutbox(this.ws, subdoc.guid);
    }
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
  nextSeq(doc: string): Promise<number> {
    return outbox.nextSeq(doc);
  }

  private syncKey(doc: string, seq: number): string {
    return `${doc}:${seq}`;
  }

  private emitSyncStatus(payload: SyncStatusPayload) {
    // @ts-ignore
    this.emit("sync:status", [payload]);
  }

  private clearAckTracking(doc: string, seq: number) {
    const key = this.syncKey(doc, seq);
    const timer = this.ackTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.ackTimers.delete(key);
    }
    const retryTimer = this.ackRetryTimers.get(key);
    if (retryTimer) {
      clearTimeout(retryTimer);
      this.ackRetryTimers.delete(key);
    }
  }

  private scheduleOutboxReplay(doc: string, seq: number, reason: string) {
    const key = this.syncKey(doc, seq);
    if (this.ackRetryTimers.has(key)) return;
    const attempts = (this.ackAttempts.get(key) || 0) + 1;
    this.ackAttempts.set(key, attempts);
    if (attempts >= syncMaxRetries) {
      this.emitSyncStatus({
        doc,
        seq,
        state: "failed",
        pending: outbox.getUnackedCount(doc),
        reason: "retry_exhausted",
      });
      return;
    }
    this.emitSyncStatus({
      doc,
      seq,
      state: "failed",
      pending: outbox.getUnackedCount(doc),
      reason,
    });
    const delay = Math.min(
      syncRetryBaseDelayMs * Math.pow(2, attempts - 1),
      syncRetryMaxDelayMs
    );
    const timer = setTimeout(() => {
      this.ackRetryTimers.delete(key);
      if (this.wsconnected && this.ws?.connected) {
        void this.replayOutbox(this.ws);
      }
    }, delay);
    this.ackRetryTimers.set(key, timer);
  }

  private trackAck(doc: string, seq: number) {
    if (!this.wsconnected || !this.ws || !this.ws.connected) {
      return;
    }
    const key = this.syncKey(doc, seq);
    this.clearAckTracking(doc, seq);
    const timer = setTimeout(() => {
      this.ackTimers.delete(key);
      this.scheduleOutboxReplay(doc, seq, "ack_timeout");
    }, syncAckTimeout);
    this.ackTimers.set(key, timer);
  }

  private scheduleDeferredOutboxRetry(): void {
    if (
      this.outboxEnqueueDeferredTimer ||
      this.outboxEnqueueDeferred.size === 0
    ) {
      return;
    }
    this.outboxEnqueueDeferredTimer = setTimeout(() => {
      this.outboxEnqueueDeferredTimer = null;
      for (const [key, item] of this.outboxEnqueueDeferred) {
        this.outboxEnqueueDeferred.delete(key);
        this.outboxEnqueueAttempts.delete(key);
        void this.sendWithOutbox(
          item.docName,
          item.update,
          item.type,
          item.frame,
          item.askAck,
          item.seq,
          key
        );
      }
      this.scheduleDeferredOutboxRetry();
    }, syncRetryMaxDelayMs);
  }

  private flushDeferredOutboxEnqueues(): void {
    if (this.outboxEnqueueDeferred.size === 0) return;
    if (this.outboxEnqueueDeferredTimer) {
      clearTimeout(this.outboxEnqueueDeferredTimer);
      this.outboxEnqueueDeferredTimer = null;
    }
    for (const [key, item] of this.outboxEnqueueDeferred) {
      this.outboxEnqueueDeferred.delete(key);
      this.outboxEnqueueAttempts.delete(key);
      void this.sendWithOutbox(
        item.docName,
        item.update,
        item.type,
        item.frame,
        item.askAck,
        item.seq,
        key
      );
    }
  }

  private scheduleOutboxEnqueueRetry(
    key: string,
    docName: string,
    update: Uint8Array,
    type: OutboxEntryType,
    frame: OutboxFrame,
    askAck: boolean,
    seq?: number
  ): void {
    if (this.outboxEnqueueTimers.has(key)) return;
    const attempts = (this.outboxEnqueueAttempts.get(key) || 0) + 1;
    if (attempts >= syncMaxRetries) {
      this.outboxEnqueueAttempts.delete(key);
      this.outboxEnqueueDeferred.set(key, {
        docName,
        update,
        type,
        frame,
        askAck,
        seq,
      });
      this.emitSyncStatus({
        doc: docName,
        seq: seq ?? 0,
        state: "failed",
        pending: outbox.getUnackedCount(docName),
        reason: "retry_exhausted",
      });
      this.scheduleDeferredOutboxRetry();
      return;
    }
    this.outboxEnqueueAttempts.set(key, attempts);
    const delay = Math.min(
      syncRetryBaseDelayMs * Math.pow(2, attempts - 1),
      syncRetryMaxDelayMs
    );
    const timer = setTimeout(() => {
      this.outboxEnqueueTimers.delete(key);
      void this.sendWithOutbox(
        docName,
        update,
        type,
        frame,
        askAck,
        seq,
        key
      );
    }, delay);
    this.outboxEnqueueTimers.set(key, timer);
  }

  sendWithOutbox(
    docName: string,
    update: Uint8Array,
    type: OutboxEntryType,
    frame: OutboxFrame,
    askAck: boolean,
    seq?: number,
    retryKey?: string
  ): Promise<void> {
    const key =
      retryKey ||
      `${docName}:${seq === undefined ? `new-${++this.outboxEnqueueId}` : seq}`;
    const task = this.outboxSendTail.then(async () => {
      try {
        await outbox.init();
      } catch (e) {
        console.error("outbox initialization failed", e);
        this.emitSyncStatus({
          doc: docName,
          seq: seq ?? 0,
          state: "failed",
          pending: outbox.getUnackedCount(docName),
          reason: "outbox_error",
        });
        this.scheduleOutboxEnqueueRetry(
          key,
          docName,
          update,
          type,
          frame,
          askAck,
          seq
        );
        return;
      }
      let outboxSeq: number;
      try {
        if (seq === undefined) {
          outboxSeq = await outbox.enqueueNext({ doc: docName, type, update });
        } else {
          await outbox.enqueue({ doc: docName, seq, type, update });
          outboxSeq = seq;
        }
      } catch (e) {
        console.error("outbox enqueue failed", e);
        this.emitSyncStatus({
          doc: docName,
          seq: seq ?? 0,
          state: "failed",
          pending: outbox.getUnackedCount(docName),
          reason: "outbox_error",
        });
        this.scheduleOutboxEnqueueRetry(
          key,
          docName,
          update,
          type,
          frame,
          askAck,
          seq
        );
        return;
      }
      let outboxFrame: Uint8Array;
      try {
        outboxFrame = typeof frame === "function" ? frame(outboxSeq) : frame;
      } catch (e) {
        console.error("outbox frame construction failed", e);
        const enqueueTimer = this.outboxEnqueueTimers.get(key);
        if (enqueueTimer) {
          clearTimeout(enqueueTimer);
          this.outboxEnqueueTimers.delete(key);
        }
        this.outboxEnqueueAttempts.delete(key);
        this.outboxEnqueueDeferred.delete(key);
        this.trackAck(docName, outboxSeq);
        this.emitSyncStatus({
          doc: docName,
          seq: outboxSeq,
          state: "failed",
          pending: outbox.getUnackedCount(docName),
          reason: "frame_error",
        });
        return;
      }
      const enqueueTimer = this.outboxEnqueueTimers.get(key);
      if (enqueueTimer) {
        clearTimeout(enqueueTimer);
        this.outboxEnqueueTimers.delete(key);
      }
      this.outboxEnqueueAttempts.delete(key);
      this.outboxEnqueueDeferred.delete(key);
      this.emitSyncStatus({
        doc: docName,
        seq: outboxSeq,
        state: "pending",
        pending: outbox.getUnackedCount(docName),
      });
      this.trackAck(docName, outboxSeq);
      broadcastMessage(this, outboxFrame);
      if (askAck && this.wsconnected && this.ws && this.ws.connected) {
        this.ws.emit("sync:ack_req", { doc: docName, seq: outboxSeq });
      }
    });
    this.outboxSendTail = task.catch(() => undefined);
    return task;
  }

  /**
   * P1（docs/design/message-reliable.md §6.3）：处理服务端握手下发的 serverEpoch。
   * epoch 与本地缓存（localStorage）不一致 => 服务器已重启，标记 serverEpochChanged
   * 并重置 _synced，由连接建立流程（重放 Outbox + sync step1）完成完整对账。
   */
  handleServerEpoch(payload: any) {
    const epoch = payload && payload.epoch;
    if (typeof epoch !== "number") return;
    let cached: number | null = null;
    try {
      const raw = localStorage.getItem("texhub:server-epoch");
      if (raw) cached = Number(raw);
    } catch (e) {}
    this.serverEpoch = epoch;
    if (cached !== null && Number.isFinite(cached) && cached !== epoch) {
      this.serverEpochChanged = true;
      this._synced = false;
      console.warn(
        `[serverEpoch] server restarted: epoch ${cached} -> ${epoch}, triggering full resync`
      );
    }
    try {
      localStorage.setItem("texhub:server-epoch", String(epoch));
    } catch (e) {}
  }

  /**
   * P1（docs/design/message-reliable.md §6.2）：僵尸连接探测。
   * 进入 stale 窗口时先发 probe 探活；10s 内未收到 probe_ack（会经
   * markMessageReceived 刷新）则判定为僵尸连接，强制 close 触发指数退避重连。
   */
  private _staleProbeTick() {
    if (!this.wsconnected || !this.ws || !this.ws.connected) {
      this._staleProbePendingAt = 0;
      this._staleProbeAcked = true;
      return;
    }
    const now = time.getUnixTime();
    if (this._staleProbeAcked) {
      this._staleProbeAcked = false;
      this._staleProbePendingAt = now;
      try {
        this.ws.emit("probe", { probeId: "liveness" });
      } catch (e: any) {
        console.warn("[liveness] probe emit failed", e);
        this._staleProbeAcked = true;
      }
      return;
    }
    const staleSeconds = now - this._staleProbePendingAt;
    if (staleSeconds >= 10) {
      console.warn(
        `[liveness] connection considered stale: no message for ${now - this.wsLastMessageReceived}s, no probe_ack within ${staleSeconds}s, closing to trigger reconnect`
      );
      this._staleProbeAcked = true;
      this._staleProbePendingAt = 0;
      try {
        this.ws.close();
      } catch (e: any) {
        console.warn("[liveness] close failed", e);
      }
    }
  }

  /**
   * P1（docs/design/message-reliable.md §6.2）：业务消息/探活回执到达时刷新
   * 活跃度状态，使凭据 stale 窗口的连接免于被误杀。
   */
  markMessageReceived() {
    this.wsLastMessageReceived = time.getUnixTime();
    this._staleProbeAcked = true;
    this._staleProbePendingAt = 0;
  }

  handleSyncAck(payload: any) {
    const doc = payload && payload.doc;
    const seq = payload && payload.seq;
    if (
      typeof doc !== "string" ||
      typeof seq !== "number" ||
      !Number.isSafeInteger(seq) ||
      seq <= 0 ||
      (doc !== this.roomname && !this.docs.has(doc))
    ) {
      return;
    }
    void outbox
      .ack(doc, seq)
      .then(() => {
        this.clearAckTracking(doc, seq);
        this.ackAttempts.delete(this.syncKey(doc, seq));
        this.emitSyncStatus({
          doc,
          seq,
          state: "synced",
          pending: outbox.getUnackedCount(doc),
        });
      })
      .catch((e) => {
        console.error("outbox ack failed", e);
        this.clearAckTracking(doc, seq);
        this.scheduleOutboxReplay(doc, seq, "outbox_ack_error");
      });
  }

  handleSyncNack(payload: any) {
    const doc = payload && payload.doc;
    const seq = payload && payload.seq;
    if (
      typeof doc !== "string" ||
      typeof seq !== "number" ||
      !Number.isSafeInteger(seq) ||
      seq <= 0 ||
      (doc !== this.roomname && !this.docs.has(doc))
    ) {
      return;
    }
    this.clearAckTracking(doc, seq);
    this.scheduleOutboxReplay(doc, seq, payload.reason || "server_nack");
  }

  getUnackedCount(doc?: string): number {
    return outbox.getUnackedCount(doc);
  }

  /**
   * 重连时重放 Outbox 中未确认的 update（保证服务端拿到最新），再交由调用方发起
   * sync step1 对账。重放帧与原始帧完全一致（含原始 seq），服务端幂等消费安全。
   */
  private scheduleOutboxRefreshRetry(
    socketio: Socket,
    docName?: string
  ): void {
    if (this.outboxRefreshTimer) return;
    this.outboxRefreshAttempts += 1;
    if (this.outboxRefreshAttempts > syncMaxRetries) {
      this.emitSyncStatus({
        doc: docName || this.roomname,
        seq: 0,
        state: "failed",
        pending: outbox.getUnackedCount(docName),
        reason: "retry_exhausted",
      });
      return;
    }
    const delay = Math.min(
      syncRetryBaseDelayMs * Math.pow(2, this.outboxRefreshAttempts - 1),
      syncRetryMaxDelayMs
    );
    this.outboxRefreshTimer = setTimeout(() => {
      this.outboxRefreshTimer = null;
      if (socketio.connected) {
        void this.replayOutbox(socketio, docName, true);
      }
    }, delay);
  }

  async replayOutbox(
    socketio: Socket,
    docName?: string,
    retrying = false
  ): Promise<void> {
    if (!retrying) {
      this.outboxRefreshAttempts = 0;
      if (this.outboxRefreshTimer) {
        clearTimeout(this.outboxRefreshTimer);
        this.outboxRefreshTimer = null;
      }
    }
    await this.outboxSendTail.catch(() => undefined);
    try {
      await outbox.refresh();
    } catch (e) {
      console.error("outbox refresh failed", e);
      this.scheduleOutboxRefreshRetry(socketio, docName);
      return;
    }
    this.outboxRefreshAttempts = 0;
    const entries = outbox
      .getUnacked()
      .filter((entry) =>
        docName
          ? entry.doc === docName
          : entry.doc === this.roomname || this.docs.has(entry.doc)
      );
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
        this.emitSyncStatus({
          doc: entry.doc,
          seq: entry.seq,
          state: "pending",
          pending: outbox.getUnackedCount(entry.doc),
        });
        this.trackAck(entry.doc, entry.seq);
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
    seq: number,
    src = "outboxReplay"
  ): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, SyncMessageType.SubDocMessageSync);
    const uniqueValue = uuidv4();
    let msg: SyncMessageContext = {
      doc_name: docName,
      src,
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
    this.flushDeferredOutboxEnqueues();
    if (!this.wsconnected || this.ws === null || this.ws === undefined) {
      this.ackAttempts.clear();
      setupWebsocket(this);
      this.connectBc();
    }
  }
}
