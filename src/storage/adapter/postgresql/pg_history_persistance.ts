// @ts-ignore
import * as Y from "rdyjs";
import {
  getCurrentUpdateClock
} from "./history/pg_history_operation.js";
import logger from "@common/log4js_config.js";
import { SyncFileAttr } from "@/model/texhub/sync_file_attr.js";
import {
  getFileLatestSnapshot,
} from "@/service/version_service.js";
import { diffChars } from "diff";
import { getPgPool } from "./conf/database_init.js";

export class PgHisotoryPersistance {

  async storeSnapshot(syncFileAttr: SyncFileAttr, doc: Y.Doc) {
    if (typeof window !== "undefined") {
      return;
    }
    const pool = getPgPool();
    if (!pool) {
      return;
    }
    try {
      if (syncFileAttr.docIntId === "") {
        logger.error("docIntId is empty, cannot store snapshot");
        return;
      }
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
    const contextLen = 20;
    const diffArr = diffChars(prevContent, curContent);
    let result: Array<{ value: string, added?: boolean, removed?: boolean, contextBefore: string, contextAfter: string }> = [];
    for (let i = 0; i < diffArr.length; i++) {
      const part = diffArr[i];
      if (part.added || part.removed) {
        // 前 contextLen 个字符
        let before = '';
        let after = '';
        // 向前找 contextLen 个字符
        let count = 0, j = i - 1;
        while (j >= 0 && count < contextLen) {
          const val = diffArr[j].value;
          before = val.slice(-Math.min(contextLen - count, val.length)) + before;
          count += val.length;
          j--;
        }
        // 向后找 contextLen 个字符
        count = 0; j = i + 1;
        while (j < diffArr.length && count < contextLen) {
          const val = diffArr[j].value;
          after += val.slice(0, contextLen - count);
          count += val.length;
          j++;
        }
        result.push({
          value: part.value,
          added: part.added,
          removed: part.removed,
          contextBefore: before,
          contextAfter: after
        });
      }
    }
    if (result.length === 0) {
      return "";
    }
    return JSON.stringify(result);
  }
}
