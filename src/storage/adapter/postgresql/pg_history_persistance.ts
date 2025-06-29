// 仅导入类型定义，避免在浏览器环境中导入实际模块
import type * as pg from "pg";
// @ts-ignore
import * as Y from "rdyjs";
import {
  flushDocument,
  getCurrentUpdateClock,
  getHistoryDocAllUpdates,
  insertKey,
  mergeUpdates,
  readStateVector,
  storeHistoryUpdate,
  storeUpdateTrans,
} from "./history/pg_history_operation.js";
import { dbConfig } from "./conf/db_config.js";
import { TeXSync } from "@model/yjs/storage/sync/tex_sync.js";
import logger from "@common/log4js_config.js";
import PQueue from "p-queue";
import { LRUCache } from "lru-cache";
import { SyncFileAttr } from "@/model/texhub/sync_file_attr.js";
import { Op } from "sequelize";
import { ProjectScrollVersion } from "@/model/texhub/project_scroll_version.js";
import { ScrollQueryResult } from "@/common/types/scroll_query.js";
import {
  getFileLatestSnapshot,
  getProjectLatestSnapshot,
} from "@/service/version_service.js";
import { diffChars } from "diff";

export class PgHisotoryPersistance {
  pool: pg.Pool | null = null;
  queueMap: LRUCache<string, PQueue>;

  constructor() {
    this.queueMap = new LRUCache({
      max: 100,
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

  async initPool() {
    try {
      const pgModule = await import("pg");
      const { Pool } = pgModule.default || pgModule;
      this.pool = new Pool(dbConfig);
    } catch (error) {
      logger.error("Failed to initialize PostgreSQL pool:", error);
    }
  }

  async getHisotyYDoc(docName: string): Promise<Y.Doc> {
    const ydoc = new Y.Doc();
    if (typeof window !== "undefined" || !this.pool) {
      return ydoc;
    }

    const updates: Array<TeXSync> = await getHistoryDocAllUpdates(
      this.pool,
      docName
    );
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
    return ydoc;
  }

  flushDocument(docName: string, projId: string) {
    if (typeof window !== "undefined" || !this.pool) {
      return;
    }
    const updates = getHistoryDocAllUpdates(this.pool, docName);
    const { update, sv } = mergeUpdates(updates);
    let syncFileAttr: SyncFileAttr = {
      docName: docName,
      projectId: projId,
    };
    flushDocument(this.pool, update, sv, syncFileAttr);
  }

  async getStateVector(docName: string, projId: string) {
    if (typeof window !== "undefined" || !this.pool) {
      return null;
    }

    const { clock, sv } = await readStateVector(this.pool, docName);
    let curClock = -1;
    if (sv !== null) {
      curClock = await getCurrentUpdateClock(docName);
    }
    if (sv !== null && clock === curClock) {
      return sv;
    } else {
      // current state vector is outdated
      const updates = getHistoryDocAllUpdates(this.pool, docName);
      const { update, sv } = mergeUpdates(updates);
      let syncFileAttr: SyncFileAttr = {
        docName: docName,
        projectId: projId,
      };
      flushDocument(this.pool, update, sv, syncFileAttr);
      return sv;
    }
  }

  async storeUpdateTrans(docName: string, update: Uint8Array) {
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

  async storeSnapshot(syncFileAttr: SyncFileAttr, doc: Y.Doc) {
    logger.info("storeSnapshot");
    if (typeof window !== "undefined") {
      logger.info("storeSnapshot in browser");
      return;
    }
    if (!this.pool) {
      logger.info("storeSnapshot no pool");
      return;
    }
    logger.info("storeSnapshot pool");
    try {
      const latestSnapshot = await getFileLatestSnapshot(syncFileAttr.docName);
      logger.info("storeSnapshot latestSnapshot", latestSnapshot);
      const latestClock = await getCurrentUpdateClock(syncFileAttr.docName);
      logger.info("storeSnapshot latestClock", latestClock);
      if (!latestSnapshot || latestClock - latestSnapshot.clock > 500) {
        logger.info("storeSnapshot latestSnapshot");
        const snapshot: Y.Snapshot = Y.snapshot(doc);
        const encoded = Y.encodeSnapshot(snapshot);
        const prevSnapshot = latestSnapshot
          ? Y.decodeSnapshot(latestSnapshot.value)
          : null;
        const diff = latestSnapshot
          ? this.getSnapshotDiff(snapshot, prevSnapshot!)
          : "";
        const client = await this.pool.connect();
        try {
          await client.query("BEGIN");
          const key = `snapshot_${syncFileAttr.docName}_${Date.now()}`;
          await client.query(
            `INSERT INTO tex_sync_history 
            (key, value, version, content_type, doc_name, clock, source, project_id, created_time, diff) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)`,
            [
              key,
              encoded,
              "1.0", // version
              "snapshot",
              syncFileAttr.docName,
              latestClock,
              "system",
              syncFileAttr.projectId,
              diff,
            ]
          );

          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }
    } catch (error) {
      logger.error("Failed to store snapshot:", error);
      throw error;
    }
  }

  getSnapshotDiff(curSnapshot: Y.Snapshot, prevSnapshot: Y.Snapshot): string {
    let snap: Uint8Array = Y.encodeSnapshot(curSnapshot);
    let prevSnap: Uint8Array = Y.encodeSnapshot(prevSnapshot);
    let content = String.fromCharCode(...new Uint8Array(snap));
    let prevContent = String.fromCharCode(...new Uint8Array(prevSnap));
    let diff = diffChars(prevContent, content);
    return JSON.stringify(diff);
  }

  async storeHisUpdate(syncFileAttr: SyncFileAttr, update: Uint8Array) {
    if (typeof window !== "undefined" || !this.pool) {
      return;
    }
    let docName = syncFileAttr.docName + "_history";
    try {
      const cacheQueue = this.queueMap.get(docName);
      if (cacheQueue) {
        (async () => {
          await cacheQueue.add(async () => {
            await storeHistoryUpdate(syncFileAttr, update);
          });
        })();
      } else {
        const queue = new PQueue({ concurrency: 1 });
        this.queueMap.set(docName, queue);
        (async () => {
          await queue.add(async () => {
            await storeHistoryUpdate(syncFileAttr, update);
          });
        })();
      }
    } catch (error) {
      logger.error("store update failed", error);
    }
  }

  async insertKeys(keyMap: any[], originalKey: any[]) {
    if (typeof window !== "undefined" || !this.pool) {
      return;
    }

    return await insertKey(this.pool, keyMap, originalKey);
  }

  async getDiff(docName: any, stateVector: any) {
    const ydoc: any = await this.getHisotyYDoc(docName);
    return Y.encodeStateAsUpdate(ydoc, stateVector);
  }
}
