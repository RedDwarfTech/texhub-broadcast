// 仅导入类型定义，避免在浏览器环境中导入实际模块
import type * as pg from "pg";
// @ts-ignore
import * as Y from "rdyjs";
import {
  getCurrentUpdateClock
} from "./history/pg_history_operation.js";
import { dbConfig } from "./conf/db_config.js";
import logger from "@common/log4js_config.js";
import PQueue from "p-queue";
import { LRUCache } from "lru-cache";
import { SyncFileAttr } from "@/model/texhub/sync_file_attr.js";
import {
  getFileLatestSnapshot,
} from "@/service/version_service.js";
import { diffChars } from "diff";
import { getPgPool } from "./conf/database_init.js";

export class PgHisotoryPersistance {
  queueMap: LRUCache<string, PQueue>;

  constructor() {
    this.queueMap = new LRUCache({
      max: 100,
    });
    // 不再初始化pool，直接用公共连接
  }

  async storeSnapshot(syncFileAttr: SyncFileAttr, doc: Y.Doc) {
    if (typeof window !== "undefined") {
      return;
    }
    const pool = getPgPool();
    if (!pool) {
      return;
    }
    try {
      const latestSnapshot = await getFileLatestSnapshot(syncFileAttr.docName);
      const latestClock = await getCurrentUpdateClock(syncFileAttr.docName);
      const snapshot: Y.Snapshot = Y.snapshot(doc);
      const encoded = Y.encodeSnapshot(snapshot);
      const curContent = doc.getText(syncFileAttr.docName).toString();
      if (curContent === latestSnapshot?.content) {
        return;
      }
      const diff = latestSnapshot
        ? this.getSnapshotDiffFromText(curContent, latestSnapshot.content)
        : this.getSnapshotDiffFromText(curContent, "");
      if (diff === "") {
        return;
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const key = `snapshot_${syncFileAttr.docName}_${Date.now()}`;
        await client.query(
          `INSERT INTO tex_sync_history 
            (key, value, version, content_type, doc_name, clock, source, project_id, created_time, diff, content, doc_int_id) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10, $11)`,
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
            curContent,
            syncFileAttr.docIntId,
          ]
        );

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        logger.error("storeSnapshot error", error);
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error("Failed to store snapshot:", error);
      throw error;
    }
  }

  getSnapshotDiffFromText(curContent: string, prevContent: string): string {
    let diff = diffChars(prevContent, curContent);
    if (diff.length === 0) {
      logger.error("no diff found", curContent, prevContent);
      return "";
    }
    return JSON.stringify(diff);
  }
}
