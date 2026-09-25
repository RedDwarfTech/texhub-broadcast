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
const COUNTER_STORE = "counters";
const DB_VERSION = 2;

const isBrowser = (): boolean => typeof window !== "undefined";
const inBrowser = (): boolean =>
  isBrowser() && typeof window.indexedDB !== "undefined";

const seqStorageKey = (doc: string) => `texhub:outbox:seq:${doc}`;

const readPersistedSeq = (doc: string): number => {
  if (!inBrowser()) return 0;
  try {
    const value = Number(window.localStorage.getItem(seqStorageKey(doc)));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch (e) {
    return 0;
  }
};

const writePersistedSeq = (doc: string, seq: number): void => {
  if (!inBrowser()) return;
  try {
    window.localStorage.setItem(seqStorageKey(doc), String(seq));
  } catch (e) {}
};

export class Outbox {
  private db: IDBDatabase | null = null;
  /** doc -> seq -> entry（内存快照，读写均以它为准，异步同步到 IndexedDB） */
  private pending = new Map<string, Map<number, OutboxEntry>>();
  /** doc -> 已分配的最大 seq */
  private lastSeq = new Map<string, number>();
  private initPromise: Promise<void> | null = null;

  init(): Promise<void> {
    if (!isBrowser()) return Promise.resolve();
    if (!inBrowser()) {
      return Promise.reject(new Error("IndexedDB is unavailable"));
    }
    if (!this.initPromise) {
      const promise = this._init().catch((error) => {
        this.db?.close();
        this.db = null;
        this.initPromise = null;
        throw error;
      });
      this.initPromise = promise;
    }
    return this.initPromise;
  }

  private _init(): Promise<void> {
    return new Promise((resolve, reject) => {
      let request: IDBOpenDBRequest;
      let settled = false;
      const resolveOnce = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const rejectOnce = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      try {
        request = window.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        rejectOnce(e);
        return;
      }
      request.onupgradeneeded = (event) => {
        if (settled) return;
        try {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE, { keyPath: "key" });
          }
          if (!db.objectStoreNames.contains(COUNTER_STORE)) {
            db.createObjectStore(COUNTER_STORE, { keyPath: "doc" });
          }
        } catch (e) {
          rejectOnce(e);
        }
      };
      request.onsuccess = () => {
        if (settled) {
          request.result.close();
          return;
        }
        this.db = request.result;
        this.db.onversionchange = () => {
          this.db?.close();
          this.db = null;
          this.initPromise = null;
        };
        this._loadAll()
          .then(() => this._seedCounters())
          .then(resolveOnce)
          .catch((e) => {
            this.db?.close();
            this.db = null;
            rejectOnce(e);
          });
      };
      request.onerror = () => {
        request.result?.close();
        rejectOnce(request.error || new Error("IndexedDB open failed"));
      };
      request.onblocked = () => {
        rejectOnce(new Error("IndexedDB open blocked"));
      };
    });
  }

  private _loadAll(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("IndexedDB is unavailable"));
        return;
      }
      try {
        const tx = this.db.transaction(STORE, "readonly");
        const store = tx.objectStore(STORE);
        const req = store.getAll();
        const rows: any[] = [];
        req.onsuccess = () => {
          try {
            for (const row of (req.result || []) as any[]) {
              rows.push(row);
            }
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        };
        tx.oncomplete = () => {
          try {
            const loaded = new Map<string, Map<number, OutboxEntry>>();
            for (const row of rows) {
              if (!row || typeof row.doc !== "string") continue;
              let map = loaded.get(row.doc);
              if (!map) {
                map = new Map();
                loaded.set(row.doc, map);
              }
              if (typeof row.seq === "number") {
                map.set(row.seq, {
                  doc: row.doc,
                  seq: row.seq,
                  type: row.type === "subdoc" ? "subdoc" : "root",
                  update: new Uint8Array(row.update || []),
                });
                const cur = Math.max(
                  this.lastSeq.get(row.doc) || 0,
                  readPersistedSeq(row.doc)
                );
                if (row.seq > cur) {
                  this.lastSeq.set(row.doc, row.seq);
                  writePersistedSeq(row.doc, row.seq);
                } else if (cur > 0) {
                  this.lastSeq.set(row.doc, cur);
                }
              }
            }
            this.pending = loaded;
            resolve();
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        };
        req.onerror = () => {
          reject(req.error || new Error("IndexedDB read failed"));
        };
        tx.onerror = () => {
          reject(tx.error || new Error("IndexedDB read transaction failed"));
        };
        tx.onabort = () => {
          reject(tx.error || new Error("IndexedDB read transaction aborted"));
        };
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  private _seedCounters(): Promise<void> {
    if (!this.db || this.pending.size === 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      try {
        const db = this.db;
        if (!db) {
          reject(new Error("IndexedDB is unavailable"));
          return;
        }
        const tx = db.transaction(COUNTER_STORE, "readwrite");
        const store = tx.objectStore(COUNTER_STORE);
        for (const doc of this.pending.keys()) {
          const req = store.get(doc);
          req.onsuccess = () => {
            const row = req.result as { seq?: number } | undefined;
            const target = Math.max(
              Number(row?.seq) || 0,
              this.lastSeq.get(doc) || 0,
              readPersistedSeq(doc)
            );
            if (target > (Number(row?.seq) || 0)) {
              store.put({ doc, seq: target });
            }
          };
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("counter seed failed"));
        tx.onabort = () => reject(tx.error || new Error("counter seed aborted"));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  async refresh(): Promise<void> {
    await this.init();
    if (!this.db) return;
    await this._loadAll();
  }

  private _remove(doc: string, seq: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        if (inBrowser()) {
          reject(new Error("IndexedDB is unavailable"));
        } else {
          resolve();
        }
        return;
      }
      try {
        const tx = this.db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        const req = store.delete(`${doc}:${seq}`);
        tx.oncomplete = () => resolve();
        tx.onerror = () => {
          reject(tx.error || req.error || new Error("IndexedDB delete failed"));
        };
        tx.onabort = () => {
          reject(tx.error || new Error("IndexedDB delete aborted"));
        };
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  private _allocateSeq(doc: string): Promise<number> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        if (inBrowser()) {
          reject(new Error("IndexedDB is unavailable"));
          return;
        }
        const current = Math.max(
          this.lastSeq.get(doc) || 0,
          readPersistedSeq(doc)
        );
        const next = current + 1;
        this.lastSeq.set(doc, next);
        writePersistedSeq(doc, next);
        resolve(next);
        return;
      }
      let next = 0;
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      try {
        const tx = this.db.transaction(COUNTER_STORE, "readwrite");
        const store = tx.objectStore(COUNTER_STORE);
        const req = store.get(doc);
        req.onsuccess = () => {
          try {
            const row = req.result as { seq?: number } | undefined;
            const current = Math.max(
              Number(row?.seq) || 0,
              this.lastSeq.get(doc) || 0,
              readPersistedSeq(doc)
            );
            next = current + 1;
            store.put({ doc, seq: next });
          } catch (e) {
            fail(e);
          }
        };
        req.onerror = () => {
          fail(req.error || new Error("IndexedDB counter read failed"));
        };
        tx.oncomplete = () => {
          if (settled) return;
          try {
            this.lastSeq.set(doc, next);
            writePersistedSeq(doc, next);
            settled = true;
            resolve(next);
          } catch (e) {
            fail(e);
          }
        };
        tx.onerror = () => {
          fail(tx.error || new Error("IndexedDB counter transaction failed"));
        };
        tx.onabort = () => {
          fail(tx.error || new Error("IndexedDB counter transaction aborted"));
        };
      } catch (e) {
        fail(e);
      }
    });
  }

  private _persistEntry(
    entry: Omit<OutboxEntry, "seq">,
    requestedSeq: number,
    allocate: boolean
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      let storedSeq = requestedSeq;
      const addToMemory = () => {
        const fullEntry: OutboxEntry = { ...entry, seq: storedSeq };
        let map = this.pending.get(entry.doc);
        if (!map) {
          map = new Map();
          this.pending.set(entry.doc, map);
        }
        map.set(storedSeq, fullEntry);
        const current = Math.max(
          this.lastSeq.get(entry.doc) || 0,
          readPersistedSeq(entry.doc)
        );
        if (storedSeq > current) {
          this.lastSeq.set(entry.doc, storedSeq);
          writePersistedSeq(entry.doc, storedSeq);
        } else {
          this.lastSeq.set(entry.doc, current);
        }
      };
      if (!this.db) {
        if (inBrowser()) {
          reject(new Error("IndexedDB is unavailable"));
          return;
        }
        if (allocate) {
          storedSeq =
            Math.max(
              this.lastSeq.get(entry.doc) || 0,
              readPersistedSeq(entry.doc)
            ) + 1;
        }
        try {
          addToMemory();
          resolve(storedSeq);
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
        return;
      }
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      try {
        const tx = this.db.transaction([COUNTER_STORE, STORE], "readwrite");
        const counter = tx.objectStore(COUNTER_STORE);
        const updates = tx.objectStore(STORE);
        const req = counter.get(entry.doc);
        req.onsuccess = () => {
          try {
            const row = req.result as { seq?: number } | undefined;
            const current = Math.max(
              Number(row?.seq) || 0,
              this.lastSeq.get(entry.doc) || 0,
              readPersistedSeq(entry.doc)
            );
            if (allocate) {
              storedSeq = current + 1;
              counter.put({ doc: entry.doc, seq: storedSeq });
            } else {
              storedSeq = requestedSeq;
              if (requestedSeq > current) {
                counter.put({ doc: entry.doc, seq: requestedSeq });
              }
            }
            const update = new Uint8Array(entry.update);
            updates.put({
              key: `${entry.doc}:${storedSeq}`,
              doc: entry.doc,
              seq: storedSeq,
              type: entry.type,
              update: update.buffer.slice(
                update.byteOffset,
                update.byteOffset + update.byteLength
              ),
            });
          } catch (e) {
            fail(e);
          }
        };
        req.onerror = () => {
          fail(req.error || new Error("IndexedDB counter read failed"));
        };
        tx.oncomplete = () => {
          if (settled) return;
          try {
            addToMemory();
            settled = true;
            resolve(storedSeq);
          } catch (e) {
            fail(e);
          }
        };
        tx.onerror = () => {
          fail(tx.error || new Error("IndexedDB entry transaction failed"));
        };
        tx.onabort = () => {
          fail(tx.error || new Error("IndexedDB entry transaction aborted"));
        };
      } catch (e) {
        fail(e);
      }
    });
  }

  /** 追加一条未确认 update。 */
  async enqueue(entry: OutboxEntry): Promise<void> {
    await this.init();
    await this._persistEntry(entry, entry.seq, false);
  }

  async enqueueNext(
    entry: Omit<OutboxEntry, "seq">
  ): Promise<number> {
    await this.init();
    return this._persistEntry(entry, 0, true);
  }

  /** 收到服务端 ack 后删除对应条目。 */
  async ack(doc: string, seq: number): Promise<void> {
    await this.init();
    await this._remove(doc, seq);
    const map = this.pending.get(doc);
    if (map) {
      map.delete(seq);
      if (map.size === 0) this.pending.delete(doc);
    }
  }

  /** 该 doc 的下一个 seq（单调递增，跨会话不重置）。 */
  async nextSeq(doc: string): Promise<number> {
    await this.init();
    return this._allocateSeq(doc);
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