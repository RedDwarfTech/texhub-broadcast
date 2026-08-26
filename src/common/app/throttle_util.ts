import { SyncFileAttr } from "@/model/texhub/sync_file_attr.js";
import { pgHistoryDb } from "@/storage/feat/version/doc_history.js";
import logger from "@/common/log4js_config.js";
import { redis } from "@/common/cache/redis_util.js";
import _ from "lodash";
//@ts-ignore
import * as Y from "yjs";

const HISTORY_PENDING_PREFIX = "texhub:history:pending";
const HISTORY_PENDING_TTL_SECONDS = 6 * 3600;

const DISK_FLUSH_PENDING_PREFIX = "texhub:disk:flush:pending";
const DISK_FLUSH_PENDING_TTL_SECONDS = 30 * 60;

const historyPendingSetKey = (projectId: string) =>
  `${HISTORY_PENDING_PREFIX}:${projectId}`;
const historyPendingFileKey = (docIntId: string) =>
  `${HISTORY_PENDING_PREFIX}:file:${docIntId}`;

const historyDocsThrottlePool = new Map<string, ReturnType<typeof _.throttle>>();

export const getHistoryDocsThrottledFn = (docIntId: string) => {
  if (!historyDocsThrottlePool.has(docIntId)) {
    historyDocsThrottlePool.set(docIntId, _.throttle(
      async (syncFileAttr: SyncFileAttr, ydoc: Y.Doc) => {
        await pgHistoryDb.storeHistorySnapshot(syncFileAttr, ydoc);
        await clearHistoryPending(syncFileAttr.projectId, syncFileAttr.docIntId!);
      },
      6000,
      { leading: false, trailing: true }
    ));
    logger.info("[history] throttle created", {
      docIntId,
      time: new Date().toISOString(),
    });
  }
  return historyDocsThrottlePool.get(docIntId)!;
};

const historyDocSnapshotPool = new Map<string, Map<string, { syncFileAttr: SyncFileAttr; ydoc: Y.Doc }>>();

export const recordHistoryDocSnapshot = (syncFileAttr: SyncFileAttr, ydoc: Y.Doc) => {
  const projectId = syncFileAttr.projectId;
  let projectFiles = historyDocSnapshotPool.get(projectId);
  if (!projectFiles) {
    projectFiles = new Map<string, { syncFileAttr: SyncFileAttr; ydoc: Y.Doc }>();
    historyDocSnapshotPool.set(projectId, projectFiles);
  }
  projectFiles.set(syncFileAttr.docIntId!, { syncFileAttr, ydoc });
};

/**
 * 将文件标记为"有未落库的历史快照"，写入 Redis 共享存储。
 * 这样即便 broadcast 重启或多实例部署，项目级 flush 也能找到需要处理的文件。
 */
export const markHistoryPending = async (
  projectId: string,
  docIntId: string,
  docName: string
) => {
  if (!redis) return;
  try {
    await redis
      .pipeline()
      .sadd(historyPendingSetKey(projectId), docIntId)
      .hset(historyPendingFileKey(docIntId), { projectId, docName, docIntId })
      .expire(historyPendingSetKey(projectId), HISTORY_PENDING_TTL_SECONDS)
      .expire(historyPendingFileKey(docIntId), HISTORY_PENDING_TTL_SECONDS)
      .exec();
  } catch (error) {
    logger.error("[history] mark history pending failed", error);
  }
};

const clearHistoryPending = async (projectId: string, docIntId: string) => {
  if (!redis) return;
  try {
    await redis
      .pipeline()
      .srem(historyPendingSetKey(projectId), docIntId)
      .del(historyPendingFileKey(docIntId))
      .exec();
  } catch (error) {
    logger.error("[history] clear history pending failed", error);
  }
};

const getHistoryPendingFileIds = async (projectId: string): Promise<string[]> => {
  if (!redis) return [];
  try {
    return await redis.smembers(historyPendingSetKey(projectId));
  } catch (error) {
    logger.error("[history] get pending file ids failed", error);
    return [];
  }
};

const getHistoryPendingFile = async (
  docIntId: string
): Promise<{ projectId: string; docName: string } | null> => {
  if (!redis) return null;
  try {
    const info = await redis.hgetall(historyPendingFileKey(docIntId));
    if (!info || !info.projectId || !info.docName) {
      return null;
    }
    return { projectId: info.projectId, docName: info.docName };
  } catch (error) {
    logger.error("[history] get pending file failed", error);
    return null;
  }
};

/**
 * 兜底：当本实例内存中没有该文件的节流池（实例重启或多实例场景），
 * 从共享 Postgres 持久化重建最新文档内容并写入历史快照。
 */
const flushSingleHistoryDocFallback = async (projectId: string, fileId: string) => {
  const pendingFile = await getHistoryPendingFile(fileId);
  if (!pendingFile || pendingFile.projectId !== projectId) {
    logger.warn("[history] flush: throttle not found and no pending marker", {
      projectId,
      fileId,
      poolKeys: Array.from(historyDocsThrottlePool.keys()),
      pending: !!pendingFile,
      time: new Date().toISOString(),
    });
    return;
  }
  try {
    const { postgresqlDb } = await import("@/storage/storage.js");
    const syncFileAttr: SyncFileAttr = {
      docName: pendingFile.docName,
      projectId,
      docIntId: fileId,
      docShowName: "",
      docType: 1,
      src: "flushHistoryDocFallback",
      msgBody: {
        doc_name: pendingFile.docName,
        doc_int_id: fileId,
        src: "flushHistoryDocFallback",
        trace_id: `flush-${projectId}-${fileId}`,
      },
    };
    await postgresqlDb.waitDocUpdateStable(pendingFile.docName);
    const ydoc = await postgresqlDb.getYDoc(syncFileAttr);
    await pgHistoryDb.storeHistorySnapshot(syncFileAttr, ydoc);
    await clearHistoryPending(projectId, fileId);
    logger.info("[history] flush: snapshot stored via persistence fallback", {
      projectId,
      fileId,
      docName: pendingFile.docName,
      time: new Date().toISOString(),
    });
  } catch (error) {
    logger.error(
      `[history] flush fallback failed, projectId: ${projectId}, fileId: ${fileId}`,
      error
    );
    throw error;
  }
};

const flushSingleHistoryDoc = async (projectId: string, fileId: string) => {
  const throttledSave = historyDocsThrottlePool.get(fileId);
  if (throttledSave) {
    const result = throttledSave.flush();
    if (!result) {
      logger.info("[history] flush: no pending snapshot", {
        projectId,
        fileId,
        time: new Date().toISOString(),
      });
      return;
    }
    await result;
    logger.info("[history] flush: snapshot stored", {
      projectId,
      fileId,
      time: new Date().toISOString(),
    });
    return;
  }
  await flushSingleHistoryDocFallback(projectId, fileId);
};

/**
 * 项目级刷新：具体哪些文件需要 flush 由本服务决定。
 * 目标文件 = 本实例内存挂起池 ∪ Redis 挂起标记。
 */
export const flushHistoryDoc = async (projectId: string): Promise<boolean> => {
  const inMemoryTargets = Array.from(
    historyDocSnapshotPool.get(projectId)?.keys() ?? []
  );
  const redisTargets = await getHistoryPendingFileIds(projectId);
  const targets = Array.from(new Set([...inMemoryTargets, ...redisTargets]));
  logger.info("[history] flush requested", {
    projectId,
    targetCount: targets.length,
    targets,
    time: new Date().toISOString(),
  });
  const results = await Promise.allSettled(
    targets.map((fileId) => flushSingleHistoryDoc(projectId, fileId))
  );
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      logger.error(
        `flush history snapshot failed, fileId: ${targets[index]}`,
        result.reason
      );
    }
  }
  return results.every((r) => r.status === "fulfilled");
};

export const cleanupHistoryDocForProject = async (projectId: string) => {
  await flushHistoryDoc(projectId);
  const projectFiles = historyDocSnapshotPool.get(projectId);
  if (projectFiles) {
    for (const fileId of projectFiles.keys()) {
      historyDocsThrottlePool.delete(fileId);
    }
  }
  historyDocSnapshotPool.delete(projectId);
};

// ==================== Disk Flush Pending Pool ====================

const diskFlushPendingPool = new Map<string, Map<string, { syncFileAttr: SyncFileAttr; ydoc: Y.Doc }>>();

const diskFlushPendingSetKey = (projectId: string) =>
  `${DISK_FLUSH_PENDING_PREFIX}:${projectId}`;
const diskFlushPendingFileKey = (docIntId: string) =>
  `${DISK_FLUSH_PENDING_PREFIX}:file:${docIntId}`;

/**
 * Record a file as having unsaved in-memory changes for disk flush.
 * Called on every YDoc update so that /doc/flush/project can use the live Y.Doc
 * instead of reconstructing from PostgreSQL.
 */
export const markDiskFlushPending = (
  syncFileAttr: SyncFileAttr,
  ydoc: Y.Doc
) => {
  const projectId = syncFileAttr.projectId;
  const fileId = syncFileAttr.docIntId || syncFileAttr.docName;
  let projectFiles = diskFlushPendingPool.get(projectId);
  if (!projectFiles) {
    projectFiles = new Map();
    diskFlushPendingPool.set(projectId, projectFiles);
  }
  projectFiles.set(fileId, { syncFileAttr, ydoc });
};

/**
 * Mark disk flush pending in Redis for cross-instance awareness.
 */
export const markDiskFlushPendingRedis = async (
  projectId: string,
  docIntId: string,
  docName: string
) => {
  if (!redis) return;
  try {
    await redis
      .pipeline()
      .sadd(diskFlushPendingSetKey(projectId), docIntId)
      .hset(diskFlushPendingFileKey(docIntId), { projectId, docName, docIntId })
      .expire(diskFlushPendingSetKey(projectId), DISK_FLUSH_PENDING_TTL_SECONDS)
      .expire(diskFlushPendingFileKey(docIntId), DISK_FLUSH_PENDING_TTL_SECONDS)
      .exec();
  } catch (error) {
    logger.error("[disk-flush] mark pending failed", error);
  }
};

/**
 * Clear disk flush pending marker after successful flush.
 */
export const clearDiskFlushPending = async (projectId: string, docIntId: string) => {
  if (!redis) return;
  try {
    await redis
      .pipeline()
      .srem(diskFlushPendingSetKey(projectId), docIntId)
      .del(diskFlushPendingFileKey(docIntId))
      .exec();
  } catch (error) {
    logger.error("[disk-flush] clear pending failed", error);
  }
};

/**
 * Remove a file from the in-memory disk flush pending pool.
 */
export const removeDiskFlushPending = (projectId: string, fileId: string) => {
  const projectFiles = diskFlushPendingPool.get(projectId);
  if (projectFiles) {
    projectFiles.delete(fileId);
    if (projectFiles.size === 0) {
      diskFlushPendingPool.delete(projectId);
    }
  }
};

/**
 * Get all file IDs that need disk flush for a project.
 * Merges in-memory pool and Redis pending markers.
 */
export const getDiskFlushPendingFileIds = async (projectId: string): Promise<string[]> => {
  const inMemoryIds = Array.from(diskFlushPendingPool.get(projectId)?.keys() ?? []);
  let redisIds: string[] = [];
  if (redis) {
    try {
      redisIds = await redis.smembers(diskFlushPendingSetKey(projectId));
    } catch (error) {
      logger.error("[disk-flush] get pending file ids failed", error);
    }
  }
  return Array.from(new Set([...inMemoryIds, ...redisIds]));
};

/**
 * Get the live Y.Doc from in-memory pool for a specific file.
 * Returns null if the file is not in memory (edited in another instance or not edited).
 */
export const getDiskFlushPendingDoc = (
  projectId: string,
  fileId: string
): { syncFileAttr: SyncFileAttr; ydoc: Y.Doc } | null => {
  return diskFlushPendingPool.get(projectId)?.get(fileId) ?? null;
};

/**
 * Get Redis pending file info for fallback (reconstruct from DB).
 */
export const getDiskFlushPendingFile = async (
  docIntId: string
): Promise<{ projectId: string; docName: string } | null> => {
  if (!redis) return null;
  try {
    const info = await redis.hgetall(diskFlushPendingFileKey(docIntId));
    if (!info || !info.projectId || !info.docName) {
      return null;
    }
    return { projectId: info.projectId, docName: info.docName };
  } catch (error) {
    logger.error("[disk-flush] get pending file failed", error);
    return null;
  }
};
