import pg from "pg";
const { Pool } = pg;
// @ts-ignore
import * as Y from "yjs";
import {
  flushDocument,
  getCurrentUpdateClock,
  getDocAllUpdates,
  insertKey,
  mergeUpdates,
  readStateVector,
  storeUpdate,
  storeUpdateBySrc,
} from "./postgresql_operation.js";
import { dbConfig } from "./db_config.js";
import { PREFERRED_TRIM_SIZE } from "./postgresql_const.js";
import { TeXSync } from "../../../model/yjs/storage/sync/tex_sync.js";
import logger from "../../../common/log4js_config.js";
import PQueue from "p-queue";
import { LRUCache } from 'lru-cache';

export class PostgresqlPersistance {
  pool: pg.Pool;
  queue: PQueue;
  queueMap: LRUCache<string, PQueue>;

  constructor() {
    const pool = new Pool(dbConfig);
    this.pool = pool;
    this.queue = new PQueue({ concurrency: 1 });
    this.queueMap = new LRUCache({
      max: 100, // 最大缓存数量
    });
  }

  async getYDoc(docName: string): Promise<Y.Doc> {
    const updates: Array<TeXSync> = await getDocAllUpdates(this.pool, docName);
    const ydoc = new Y.Doc();
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
        docName,
        Y.encodeStateAsUpdate(ydoc),
        Y.encodeStateVector(ydoc)
      );
    }
    return ydoc;
  }

  flushDocument(docName: string) {
    const updates = getDocAllUpdates(this.pool, docName);
    const { update, sv } = mergeUpdates(updates);
    flushDocument(this.pool, docName, update, sv);
  }

  async getStateVector(docName: string) {
    const { clock, sv } = await readStateVector(this.pool, docName);
    let curClock = -1;
    if (sv !== null) {
      curClock = await getCurrentUpdateClock(this.pool, docName);
    }
    if (sv !== null && clock === curClock) {
      return sv;
    } else {
      // current state vector is outdated
      const updates = getDocAllUpdates(this.pool, docName);
      const { update, sv } = mergeUpdates(updates);
      flushDocument(this.pool, docName, update, sv);
      return sv;
    }
  }

  async storeUpdate(docName: string, update: Uint8Array) {
    try {
      const cacheQueue = this.queueMap.get(docName);
      if (cacheQueue) {
        (async () => {
          await cacheQueue.add(async () => {
            await storeUpdate(this.pool, docName, update);
          });
        })();
      } else {
        const queue = new PQueue({ concurrency: 1 });
        this.queueMap.set(docName, queue);
        (async () => {
          await queue.add(async () => {
            await storeUpdate(this.pool, docName, update);
          });
        })();
      }
    } catch (error) {
      logger.error("store update failed", error);
    }
  }

  async storeUpdateWithSource(keys: any[], update: Uint8Array) {
    return await storeUpdateBySrc(this.pool, update, keys);
  }

  async insertKeys(keyMap: any[], originalKey: any[]) {
    return await insertKey(this.pool, keyMap, originalKey);
  }

  async getDiff(docName: any, stateVector: any) {
    const ydoc: any = await this.getYDoc(docName);
    return Y.encodeStateAsUpdate(ydoc, stateVector);
  }
}
