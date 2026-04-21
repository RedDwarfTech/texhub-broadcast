// @ts-ignore
import * as Y from "rdyjs";
import { SyncFileAttr } from "@/model/texhub/sync_file_attr.js";
import { PostgresqlPersistance } from "../adapter/postgresql/postgresql_persistance.js";
import { persistencePostgresql } from "../storage.js";
import logger from "@/common/log4js_config.js";

export interface FullDeleteDetection {
  isFullDelete: boolean;
  previousSize: number;
  currentSize: number;
}

export interface DeletionAuditRecord {
  docName: string;
  docId?: string;
  userId?: string;
  userName?: string;
  previousContentSize: number;
  timestamp: number;
  updateHash?: string;
}

/**
 * 检测是否为完全删除操作
 */
export async function detectFullDelete(
  update: Uint8Array,
  ydoc: Y.Doc,
  syncFileAttr: SyncFileAttr
): Promise<FullDeleteDetection> {
  try {
    // 获取更新前的文档内容
    const postgresqlDb: PostgresqlPersistance = persistencePostgresql.provider;
    const oldDoc = await postgresqlDb.getYDoc(syncFileAttr);
    const oldText = oldDoc.getText(syncFileAttr.docName)?.toString() || "";

    // 创建临时文档应用更新
    const tempDoc = new Y.Doc();
    Y.applyUpdate(tempDoc, update);
    const newText = tempDoc.getText(syncFileAttr.docName)?.toString() || "";

    // 判断是否为完全删除：文档之前不为空，现在为空
    const isFullDelete = oldText.length > 0 && newText.length === 0;

    return {
      isFullDelete,
      previousSize: oldText.length,
      currentSize: newText.length
    };
  } catch (error) {
    logger.error("Failed to detect full delete", error);
    return {
      isFullDelete: false,
      previousSize: 0,
      currentSize: 0
    };
  }
}