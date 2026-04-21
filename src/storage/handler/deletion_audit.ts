import { getPgPool } from "../adapter/postgresql/conf/database_init.js";
import { DeletionAuditRecord } from "./delete_detection.js";
import logger from "@/common/log4js_config.js";

/**
 * 记录完全删除的审计日志
 */
export async function recordFullDeletion(record: DeletionAuditRecord): Promise<void> {
  try {
    const pool = getPgPool();
    if (!pool) {
      logger.warn("Database pool not available, skipping audit log");
      return;
    }

    // 首先确保审计表存在
    await ensureAuditTableExists();

    const query = `
      INSERT INTO tex_full_deletion_audit (
        doc_name, doc_id, user_id, user_name,
        previous_content_size, timestamp, update_hash, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, NOW()
      )
    `;

    const values = [
      record.docName,
      record.docId || null,
      record.userId || null,
      record.userName || null,
      record.previousContentSize,
      new Date(record.timestamp),
      record.updateHash || null
    ];

    await pool.query(query, values);

    logger.warn(`[FULL_DELETE_AUDIT] Document completely deleted: doc=${record.docName}, user=${record.userId}, size=${record.previousContentSize}`);

  } catch (error) {
    logger.error("Failed to record full deletion audit", error);
  }
}

/**
 * 查询完全删除的记录
 */
export async function queryFullDeletions(
  docName?: string,
  timeWindowDays: number = 7
): Promise<DeletionAuditRecord[]> {
  try {
    const pool = getPgPool();
    if (!pool) {
      return [];
    }

    const values: any[] = [];
    let paramIndex = 1;

    let query = `
      SELECT * FROM tex_full_deletion_audit
      WHERE created_at > NOW() - ($${paramIndex}::TEXT)::INTERVAL
    `;
    values.push(`${timeWindowDays} days`);
    paramIndex++;

    if (docName) {
      query += ` AND doc_name = $${paramIndex}`;
      values.push(docName);
      paramIndex++;
    }

    query += ` ORDER BY created_at DESC LIMIT 100`;

    const result = await pool.query(query, values);
    return result.rows.map(row => ({
      docName: row.doc_name,
      docId: row.doc_id,
      userId: row.user_id,
      userName: row.user_name,
      previousContentSize: row.previous_content_size,
      timestamp: new Date(row.timestamp).getTime(),
      updateHash: row.update_hash
    }));

  } catch (error) {
    logger.error("Failed to query full deletions", error);
    return [];
  }
}

/**
 * 确保审计表存在
 */
async function ensureAuditTableExists(): Promise<void> {
  try {
    const pool = getPgPool();
    if (!pool) return;

    // 创建表
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS tex_full_deletion_audit (
        id SERIAL PRIMARY KEY,
        doc_name VARCHAR(255) NOT NULL,
        doc_id VARCHAR(255),
        user_id VARCHAR(255),
        user_name VARCHAR(255),
        previous_content_size INTEGER NOT NULL,
        timestamp TIMESTAMP NOT NULL,
        update_hash VARCHAR(255),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await pool.query(createTableQuery);

    // 创建索引
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_doc_name ON tex_full_deletion_audit(doc_name)`,
      `CREATE INDEX IF NOT EXISTS idx_user_id ON tex_full_deletion_audit(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_created_at ON tex_full_deletion_audit(created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_timestamp ON tex_full_deletion_audit(timestamp)`
    ];

    for (const indexQuery of indexes) {
      try {
        await pool.query(indexQuery);
      } catch (err) {
        // 索引可能已存在，忽略错误
        logger.debug(`Index creation info: ${err}`);
      }
    }
  } catch (error) {
    logger.error("Failed to create audit table", error);
  }
}