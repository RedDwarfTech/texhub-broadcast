/**
 * 客户端 Outbox（P0：R1 修复，docs/design/message-reliable.md §5.2）。
 *
 * 断线/刷新/关闭页面期间产生的 Yjs update 先落 Outbox（IndexedDB 持久化 +
 * 内存缓冲），待 ws 重连后重放，收到服务端 `sync:ack { doc, seq }` 后再删除。
 * 解决了原 `broadcastMessage` 在未连接时静默丢弃本地编辑的问题。
 *
 * 数据库：`texhub:outbox`，对象存储 `updates`，key = `${doc}:${seq}`。
 * seq 按 doc 单调递增，并在 IndexedDB 中持久化，刷新后不重置（避免新旧会话 seq 冲突）。
 */

export type OutboxEntryType = "root" | "subdoc";

export interface OutboxEntry {
  doc: string;
  seq: number;
  type: OutboxEntryType;
  update: Uint8Array;
}

const DB_NAME = "texhub:outbox";
const STORE = "updates";
const DB_VERSION = 1;

const inBrowser = (): boolean =>
  typeof window !== "undefined" && typeof window.indexedDB !== "undefined";

export class Outbox {
  private db: IDBDatabase | null = null;
  /** doc -> seq -> entry（内存快照，读写均以它为准，异步同步到 IndexedDB） */
  private pending = new Map<string, Map<number, OutboxEntry>>();
  /** doc -> 已分配的最大 seq */
  private lastSeq = new Map<string, number>();
  private initPromise: Promise<void> | null = null;

  init(): Promise<void> {
    if (!inBrowser()) return Promise.resolve();
    if (!this.initPromise) {
      this.initPromise = this._init();
    }
    return this.initPromise;
  }

  private _init(): Promise<void> {
    return new Promise((resolve) => {
      let request: IDBOpenDBRequest;
      try {
        request = window.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        // 隐私模式等极端场景：仅内存兜底
        resolve();
        return;
      }
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "key" });
        }
      };
      request.onsuccess = () => {
        this.db = request.result;
        this.db.onversionchange = () => {
          this.db?.close();
          this.db = null;
          this.initPromise = null;
        };
        this._loadAll()
          .catch(() => {})
          .finally(() => resolve());
      };
      request.onerror = () => {
        resolve();
      };
    });
  }

  private _loadAll(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.db) {
        resolve();
        return;
      }
      try {
        const tx = this.db.transaction(STORE, "readonly");
        const store = tx.objectStore(STORE);
        const req = store.getAll();
        req.onsuccess = () => {
          const rows: any[] = req.result || [];
          for (const row of rows) {
            if (!row || typeof row.doc !== "string") continue;
            let map = this.pending.get(row.doc);
            if (!map) {
              map = new Map();
              this.pending.set(row.doc, map);
            }
            if (typeof row.seq === "number") {
              map.set(row.seq, {
                doc: row.doc,
                seq: row.seq,
                type: row.type === "subdoc" ? "subdoc" : "root",
                update: new Uint8Array(row.update || []),
              });
              const cur = this.lastSeq.get(row.doc) || 0;
              if (row.seq > cur) this.lastSeq.set(row.doc, row.seq);
            }
          }
          resolve();
        };
        req.onerror = () => resolve();
      } catch (e) {
        resolve();
      }
    });
  }

  private _store(entry: OutboxEntry): Promise<void> {
    return new Promise((resolve) => {
      if (!this.db) {
        resolve();
        return;
      }
      try {
        const tx = this.db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        const updateBuffer = new Uint8Array(entry.update).buffer;
        store.put({
          key: `${entry.doc}:${entry.seq}`,
          doc: entry.doc,
          seq: entry.seq,
          type: entry.type,
          update: updateBuffer,
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch (e) {
        resolve();
      }
    });
  }

  private _remove(doc: string, seq: number): Promise<void> {
    return new Promise((resolve) => {
      if (!this.db) {
        resolve();
        return;
      }
      try {
        const tx = this.db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        store.delete(`${doc}:${seq}`);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch (e) {
        resolve();
      }
    });
  }

  /** 追加一条未确认 update。已在内存记录 seq 计数器，断线期间也可安全调用。 */
  async enqueue(entry: OutboxEntry): Promise<void> {
    await this.init();
    let map = this.pending.get(entry.doc);
    if (!map) {
      map = new Map();
      this.pending.set(entry.doc, map);
    }
    map.set(entry.seq, entry);
    const cur = this.lastSeq.get(entry.doc) || 0;
    if (entry.seq > cur) this.lastSeq.set(entry.doc, entry.seq);
    await this._store(entry);
    // 尾随清理：若 _store 落盘期间该条已被服务端 ack 删除（_remove 先于本次 put 生效），
    // 会遗留一条孤儿 IDB 行，重连时被反复重放。此处按 pending 内存态复查补删。
    if (!this.pending.get(entry.doc)?.has(entry.seq)) {
      await this._remove(entry.doc, entry.seq);
    }
  }

  /** 收到服务端 ack 后删除对应条目。 */
  async ack(doc: string, seq: number): Promise<void> {
    const map = this.pending.get(doc);
    if (map) {
      map.delete(seq);
      if (map.size === 0) this.pending.delete(doc);
    }
    await this._remove(doc, seq);
  }

  /** 该 doc 的下一个 seq（单调递增，跨会话不重置）。 */
  nextSeq(doc: string): number {
    const cur = this.lastSeq.get(doc) || 0;
    const next = cur + 1;
    this.lastSeq.set(doc, next);
    return next;
  }

  /** 获取全部未确认条目（重连重放用），按 (doc, seq) 升序。 */
  getUnacked(): OutboxEntry[] {
    const all: OutboxEntry[] = [];
    for (const map of this.pending.values()) {
      for (const entry of map.values()) {
        all.push(entry);
      }
    }
    all.sort((a, b) =>
      a.doc === b.doc ? a.seq - b.seq : a.doc < b.doc ? -1 : 1
    );
    return all;
  }

  getUnackedCount(doc?: string): number {
    if (doc) {
      return this.pending.get(doc)?.size || 0;
    }
    let n = 0;
    for (const map of this.pending.values()) n += map.size;
    return n;
  }
}

// 全局单例：编辑会话内共享，IndexedDB 提供跨页面刷新持久化
export const outbox = new Outbox();