// 仅导入类型定义，避免在浏览器环境中导入实际模块
import type * as pg from "pg";
// @ts-ignore
import * as Y from "rdyjs";
import {
  flushDocument,
  getCurrentUpdateClock,
  getDocAllUpdates,
  insertKey,
  mergeUpdates,
  readStateVector,
  storeUpdate,
  storeUpdateBySrc,
  storeUpdateTrans,
} from "./postgresql_operation.js";
import { dbConfig } from "./conf/db_config.js";
import { PREFERRED_TRIM_SIZE } from "./conf/postgresql_const.js";
import { TeXSync } from "@model/yjs/storage/sync/tex_sync.js";
import logger from "@common/log4js_config.js";
import PQueue from "p-queue";
import { LRUCache } from "lru-cache";
import { SyncFileAttr } from "@/model/texhub/sync_file_attr.js";

export class PostgresqlPersistance {
  pool: pg.Pool | null = null;
  queueMap: LRUCache<string, PQueue>;

  constructor() {
    this.queueMap = new LRUCache({
      max: 100, // 最大缓存数量
    });

    // 仅在Node环境下初始化数据库连接池
    if (typeof window === "undefined") {
      this.initPool();
    } else {
      logger.info(
        "PostgresqlPersistance running in browser environment, database features disabled"
      );
    }
  }

  // 使用异步方法初始化连接池
  async initPool() {
    try {
      // 动态导入pg模块
      const pgModule = await import("pg");
      const { Pool } = pgModule.default || pgModule;
      this.pool = new Pool(dbConfig);
    } catch (error) {
      logger.error("Failed to initialize PostgreSQL pool:", error);
    }
  }

  async getYDoc(syncFileAttr: SyncFileAttr): Promise<Y.Doc> {
    const ydoc = new Y.Doc();
    if (typeof window !== "undefined" || !this.pool) {
      return ydoc;
    }

    const updates: Array<TeXSync> = await getDocAllUpdates(syncFileAttr.docName);
    ydoc.transact(() => {
      try {
        for (let i = 0; i < updates.length; i++) {
          let update: TeXSync = updates[i];
          let updateVal: Uint8Array = update.value;
          Y.applyUpdate(ydoc, updateVal);
        }
      } catch (err) {
        logger.error("apply update failed", err);
      }
    });
    if (updates.length > PREFERRED_TRIM_SIZE) {
      flushDocument(
        this.pool,
        syncFileAttr,
        Y.encodeStateAsUpdate(ydoc),
        Y.encodeStateVector(ydoc)
      );
    }
    return ydoc;
  }

  flushDocument(syncFileAttr: SyncFileAttr) {
    if (typeof window !== "undefined" || !this.pool) {
      return;
    }

    const updates = getDocAllUpdates(syncFileAttr.docName);
    const { update, sv } = mergeUpdates(updates);
    flushDocument(this.pool, syncFileAttr, update, sv);
  }

  async getStateVector(syncFileAttr: SyncFileAttr) {
    if (typeof window !== "undefined" || !this.pool) {
      return null;
    }

    const { clock, sv } = await readStateVector(this.pool, syncFileAttr.docName);
    let curClock = -1;
    if (sv !== null) {
      curClock = await getCurrentUpdateClock(syncFileAttr.docName);
    }
    if (sv !== null && clock === curClock) {
      return sv;
    } else {
      // current state vector is outdated
      const updates = getDocAllUpdates(syncFileAttr.docName);
      const { update, sv } = mergeUpdates(updates);
      flushDocument(this.pool, syncFileAttr, update, sv);
      return sv;
    }
  }

  async storeUpdateTrans(docName: string, update: Uint8Array) {
    // 在浏览器环境中不执行操作
    if (typeof window !== "undefined" || !this.pool) {
      return;
    }

    const client: pg.PoolClient = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await storeUpdateTrans(client, docName, update);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async storeUpdate(syncFileAttr: SyncFileAttr, update: Uint8Array) {
    if (typeof window !== "undefined" || !this.pool) {
      return;
    }

    try {
      const cacheQueue = this.queueMap.get(syncFileAttr.docName);
      if (cacheQueue) {
        (async () => {
          await cacheQueue.add(async () => {
            await storeUpdate(syncFileAttr, update);
          });
        })();
      } else {
        const queue = new PQueue({ concurrency: 1 });
        this.queueMap.set(syncFileAttr.docName, queue);
        (async () => {
          await queue.add(async () => {
            await storeUpdate(syncFileAttr, update);
          });
        })();
      }
    } catch (error) {
      logger.error("store update failed", error);
    }
  }

  async storeUpdateWithSource(keys: any[], update: Uint8Array) {
    if (typeof window !== "undefined" || !this.pool) {
      return;
    }

    return await storeUpdateBySrc(update, keys);
  }

  async insertKeys(keyMap: any[], originalKey: any[]) {
    if (typeof window !== "undefined" || !this.pool) {
      return;
    }

    return await insertKey(this.pool, keyMap, originalKey);
  }

  async getDiff(docName: any, stateVector: any) {
    const ydoc: any = await this.getYDoc(docName);
    return Y.encodeStateAsUpdate(ydoc, stateVector);
  }
}
