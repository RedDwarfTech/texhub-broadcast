// 仅导入类型定义，避免在浏览器环境中导入实际模块
import type * as pg from "pg";
// @ts-ignore
import * as Y from "yjs";
import {
  flushDocument,
  getCurrentUpdateClock,
  getDocAllUpdates,
  insertKey,
  mergeUpdates,
  readStateVector,
  storeUpdateBySrc,
  storeUpdateTrans,
} from "./postgresql_operation.js";
import { dbConfig } from "./conf/db_config.js";
import { PREFERRED_TRIM_SIZE } from "./conf/postgresql_const.js";
import { TeXSync } from "@model/yjs/storage/sync/tex_sync.js";
import logger from "@common/log4js_config.js";
import { SyncFileAttr } from "@/model/texhub/sync_file_attr.js";
import { UpdateOrigin } from "@/model/yjs/net/update_origin.js";
import {
  appendUpdateToWAL,
  waitDocWALDrained,
} from "@/storage/wal/wal_update_handler.js";

export class PostgresqlPersistance {
  pool: pg.Pool | null = null;

  constructor() {
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

    const updates: Array<TeXSync> = await getDocAllUpdates(
      syncFileAttr.docName
    );
    ydoc.transact(() => {
      try {
        for (let i = 0; i < updates.length; i++) {
          let update: TeXSync = updates[i];
          let updateVal: Uint8Array = update.value;
          let uo: UpdateOrigin = {
            name: "getYDoc",
            origin: "server",
          };
          Y.applyUpdate(ydoc, updateVal, uo);
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

    const { clock, sv } = await readStateVector(
      this.pool,
      syncFileAttr.docName
    );
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

  /**
   * @deprecated 使用 appendUpdateToWAL（Redis Stream 预写日志）替代。
   * 原"进程内 PQueue + fire-and-forget"的排队职责整体由 WAL 顶替（R2 修复）。
   * 保留此方法仅作为兼容入口。
   */
  async putUpdateToQueue(syncFileAttr: SyncFileAttr, update: Uint8Array) {
    return this.appendUpdateToWAL(syncFileAttr, update);
  }

  /**
   * 追加更新到 Redis Stream WAL（await XADD，命令级确认）。
   * PROJECT 根 doc 跳过；缺 docShowName 时自动用 getTexFileInfo 富化。
   * WAL Worker 幂等消费后写入 tex_sync。
   */
  async appendUpdateToWAL(syncFileAttr: SyncFileAttr, update: Uint8Array) {
    return appendUpdateToWAL(syncFileAttr, update);
  }

  /**
   * 等待某个文档的更新落库并趋于稳定。
   *
   * 编译前强制 flush 使用：保证点击编译时的内容已经写入 tex_sync，
   * 从而 getYDoc 能重建出最新文本。返回 false 表示该文档在库中
   * 没有任何更新（无需 flush）。
   */
  async waitDocUpdateStable(
    docName: string,
    settleMs: number = 100,
    timeoutMs: number = 5000
  ): Promise<boolean> {
    if (typeof window !== "undefined" || !this.pool) {
      return false;
    }
    // 先等待 WAL 消费排空（XPENDING == 0），保证待落库 update 已进入 tex_sync
    await waitDocWALDrained(docName, timeoutMs);
    const start = Date.now();
    let prevClock = await getCurrentUpdateClock(docName);
    if (prevClock === -1) {
      return false;
    }
    let stableCount = 0;
    while (Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, settleMs));
      const curClock = await getCurrentUpdateClock(docName);
      if (curClock === prevClock) {
        stableCount += 1;
        if (stableCount >= 2) {
          return true;
        }
      } else {
        stableCount = 0;
        prevClock = curClock;
      }
    }
    return true;
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
