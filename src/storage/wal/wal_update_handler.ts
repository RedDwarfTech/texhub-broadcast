import { redis } from "@/common/cache/redis_util.js";
import logger from "@common/log4js_config.js";
import { SyncFileAttr } from "@/model/texhub/sync_file_attr.js";
import { TeXFileType } from "@/model/enum/tex_file_type.js";
import { getTexFileInfo } from "@/storage/appfile.js";
import { FileContent } from "@/model/texhub/file_content.js";
import { Persistence } from "@/model/yjs/Persistence.js";
import {
  STORE_UPDATE_DEDUP,
  storeUpdate,
} from "@/storage/adapter/postgresql/postgresql_operation.js";

/**
 * Redis Stream 预写日志（WAL）——P0 消息可靠性优化（docs/design/message-reliable.md §5.1）。
 *
 * 将"每 update 直接串行 INSERT tex_sync"改为"先 XADD 进 Redis Stream，再由 Worker
 * 幂等批量落库"。XADD 在命令级确认，进程崩溃后 Stream 保持 pending 可重放，消除
 * 原 fire-and-forget PQueue 的"入队后进程崩溃丢更新"窗口（R2）。
 *
 * 命名约定：
 *   - stream  ：`texhub:sync:updates:{docName}`（每文档一条 Stream，天然保序）
 *   - group    ：`g-sync-updates`
 *   - registry ：`texhub:sync:updates:registry`（Set<docName>，供 Worker 发现动态 Stream）
 */

const STREAM_PREFIX = "texhub:sync:updates";
const REGISTRY_KEY = `${STREAM_PREFIX}:registry`;
const GROUP = "g-sync-updates";
const STREAM_PREFIX_LEN = STREAM_PREFIX.length + 1;

export const walStreamName = (docName: string): string =>
  `${STREAM_PREFIX}:${docName}`;

const docNameOfStream = (stream: string): string => stream.slice(STREAM_PREFIX_LEN);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 追加一条更新到 WAL。await XADD（命令级确认）。
 *
 * 守卫与 putUpdateToQueue 保持一致：
 *   ① docType === PROJECT 跳过（项目根 doc 不落库）；
 *   ② 缺 docShowName 时用 getTexFileInfo 富化。
 *
 * XADD 失败（Redis 短暂不可用）时降级为直接 storeUpdate 落库，
 * 避免在 WAL 故障期间丢更新（Yjs 幂等，且 storeUpdate 有分布式锁保证串序）。
 */
export const appendUpdateToWAL = async (
  syncFileAttr: SyncFileAttr,
  update: Uint8Array
): Promise<boolean> => {
  if (typeof window !== "undefined") {
    return false;
  }
  if (syncFileAttr.docType === TeXFileType.PROJECT) {
    return false;
  }

  if (!redis) {
    // Redis 不可用：退化为直接落库，保证不丢
    const clock = await storeUpdate(syncFileAttr, update);
    return clock >= 0 || clock === STORE_UPDATE_DEDUP;
  }

  let fileInfo: FileContent | null = null;
  if (!syncFileAttr.docShowName || syncFileAttr.docShowName === "unknown") {
    try {
      fileInfo = await getTexFileInfo(syncFileAttr.docName);
    } catch (e: any) {
      logger.warn(`appendUpdateToWAL getTexFileInfo failed for ${syncFileAttr.docName}`, e);
    }
    if (!fileInfo || !fileInfo.file_path || !fileInfo.name) {
      logger.warn(
        "appendUpdateToWAL fileInfo is null or fileInfo.file_path is null" +
          JSON.stringify(fileInfo) +
          "," +
          JSON.stringify(syncFileAttr)
      );
      return false;
    }
    syncFileAttr.docShowName = fileInfo.name;
  }

  const stream = walStreamName(syncFileAttr.docName);
  const updateBase64 = Buffer.from(update as any).toString("base64");
  try {
    await redis.sadd(REGISTRY_KEY, syncFileAttr.docName);
    await redis.xadd(
      stream,
      "*",
      "docName", syncFileAttr.docName || "",
      "projectId", syncFileAttr.projectId || "",
      "docIntId", syncFileAttr.docIntId || "",
      "docShowName", syncFileAttr.docShowName || "",
      "docType", String(syncFileAttr.docType),
      "src", syncFileAttr.src || "wal",
      "update", updateBase64
    );
    return true;
  } catch (error) {
    logger.error(`appendUpdateToWAL XADD failed for ${stream}`, error);
    // 降级：直接落库，尽力不丢
    try {
      const clock = await storeUpdate(syncFileAttr, update);
      return clock >= 0 || clock === STORE_UPDATE_DEDUP;
    } catch (e2) {
      logger.error("appendUpdateToWAL fallback storeUpdate failed", e2);
    }
    return false;
  }
};

/* ------------------------------------------------------------------ */
/* Worker：XREADGROUP 幂等消费 -> storeUpdate -> XACK                   */
/* ------------------------------------------------------------------ */

let workerStarted = false;

const ensureGroup = async (stream: string): Promise<void> => {
  try {
    await redis!.xgroup("CREATE", stream, GROUP, "0", "MKSTREAM");
  } catch (e: any) {
    // BUSYGROUP 已存在属正常情况
    if (String(e?.message || e).indexOf("BUSYGROUP") === -1) {
      logger.warn(`ensureGroup failed for ${stream}`, e);
    }
  }
};

// 解析 ioredis XREADGROUP 的原始回复（两种形态都兼容）
type WalEntry = { id: string; fields: Record<string, string> };

/** 解析单条消息数组形态：[[id, [f,v,...]]]；同时兼容 { id, message } 对象形态 */
const parseRawMsgs = (msgs: any[]): WalEntry[] => {
  const items: WalEntry[] = [];
  for (const m of msgs || []) {
    if (!m) continue;
    if (Array.isArray(m)) {
      const id = m[0];
      const flat = m[1] || [];
      const fields: Record<string, string> = {};
      for (let i = 0; i + 1 < flat.length; i += 2) {
        fields[String(flat[i])] = String(flat[i + 1]);
      }
      items.push({ id: String(id), fields });
    } else if (typeof m === "object") {
      const id = m.id;
      const message =
        m.message && typeof m.message === "object" ? m.message : {};
      const fields: Record<string, string> = {};
      for (const k of Object.keys(message)) {
        fields[k] = String(message[k]);
      }
      items.push({ id: String(id), fields });
    }
  }
  return items;
};

const parseEntriesSerially = (reply: any): Array<{ stream: string; items: WalEntry[] }> => {
  const out: Array<{ stream: string; items: WalEntry[] }> = [];
  if (!reply) return out;
  // 形态1：ioredis 高层对象 [{ name, messages:[{id, message}] }]
  if (Array.isArray(reply) && typeof reply[0]?.name === "string") {
    for (const item of reply) {
      const items: WalEntry[] = (item.messages || []).map((m: any) => ({
        id: m.id,
        fields: m.message || {},
      }));
      out.push({ stream: item.name, items });
    }
    return out;
  }
  // 形态2：原始 [ [stream, [ [id, [f,v,...]] ] ] ]
  if (Array.isArray(reply)) {
    for (const group of reply) {
      if (!Array.isArray(group) || group.length < 2) continue;
      out.push({ stream: group[0], items: parseRawMsgs(group[1]) });
    }
  }
  return out;
};

const parseFields = (fields: Record<string, string>): SyncFileAttr => {
  return {
    docName: fields.docName || "",
    docType: Number(fields.docType) || TeXFileType.TEX,
    projectId: fields.projectId || "",
    docIntId: fields.docIntId || "",
    docShowName: fields.docShowName || "",
    src: fields.src || "wal-worker",
  };
};

const isShutdownSignal = (err: any): boolean => {
  const msg = String(err?.message || err);
  return msg === "Node is in Cluster mode" || msg.indexOf("NOGROUP") !== -1 || msg.indexOf("READONLY") !== -1;
};

const processEntries = async (
  stream: string,
  items: WalEntry[],
  consumer: string
): Promise<void> => {
  for (const item of items) {
    try {
      const syncFileAttr = parseFields(item.fields);
      const updateBase64 = item.fields.update;
      if (!updateBase64) {
        logger.warn(`[wal] entry without update payload, dropping ${stream} ${item.id}`);
        await redis!.xack(stream, GROUP, item.id);
        continue;
      }
      const update = new Uint8Array(Buffer.from(updateBase64, "base64"));
      const result = await storeUpdate(syncFileAttr, update);
      if (result === STORE_UPDATE_DEDUP || result >= 0) {
        await redis!.xack(stream, GROUP, item.id);
      } else {
        logger.warn("[wal] storeUpdate failed, keep pending for retry", {
          stream,
          id: item.id,
          doc: syncFileAttr.docName,
          src: syncFileAttr.src,
        });
      }
    } catch (e: any) {
      if (isShutdownSignal(e)) {
        logger.warn(`[wal] shutdown signal on ${stream} ${item.id}, keep pending`, e);
      } else {
        logger.error(`[wal] consume entry failed ${stream} ${item.id}`, e);
      }
    }
  }
};

const drainStreamsOnce = async (consumer: string): Promise<void> => {
  if (!redis) return;
  let docNames: string[] = [];
  try {
    docNames = await redis.smembers(REGISTRY_KEY);
  } catch (e: any) {
    logger.warn("[wal] smembers registry failed", e);
    return;
  }
  if (docNames.length === 0) return;

  const streams = docNames.map(walStreamName);
  for (const stream of streams) {
    await ensureGroup(stream);
  }

  // 先认领陈旧的 pending（上次进程崩溃遗留），再读取新消息
  let reclaimed: Array<{ stream: string; items: WalEntry[] }> = [];
  for (const stream of streams) {
    try {
      const reply = await redis.xautoclaim(
        stream,
        GROUP,
        consumer,
        30000,
        "0",
        "COUNT",
        100
      );
      const parsed = parseEntriesSerially([
        [stream, Array.isArray(reply) ? reply[1] : []],
      ]);
      reclaimed = reclaimed.concat(parsed);
    } catch (e: any) {
      // 无 pending 或组刚创建属正常
      if (String(e?.message || e).indexOf("NOGROUP") === -1) {
        logger.debug(`[wal] xautoclaim skipped ${stream}`, e);
      }
    }
  }
  if (reclaimed.length) {
    for (const item of reclaimed) {
      await processEntries(item.stream, item.items, consumer);
    }
  }

  // 读取新消息（Blocking，单轮内对每个 Stream 依次读取，保证单文档串行）
  try {
    const reply = await redis.xreadgroup(
      "GROUP", GROUP, consumer,
      "COUNT", "100",
      "BLOCK", "3000",
      "STREAMS", ...streams, ...streams.map(() => ">")
    );
    const parsed = parseEntriesSerially(reply);
    for (const item of parsed) {
      await processEntries(item.stream, item.items, consumer);
    }
  } catch (e: any) {
    if (isShutdownSignal(e)) {
      // 集群切换等瞬时错误，下一轮再试
    } else {
      logger.error("[wal] xreadgroup failed", e);
    }
  }
};

type WalWorkerOptions = {
  /** 首次启动等待 PG/Redis 就绪的最长时间（ms） */
  readyTimeoutMs?: number;
  /** 每轮 idle 退避（ms） */
  idleBackoffMs?: number;
};

/**
 * 启动 WAL Worker（幂等，仅服务端生效）。
 * 等待 PostgreSQL 连接池就绪后进入消费循环。
 */
export const startWALWorker = (opts: WalWorkerOptions = {}): void => {
  if (workerStarted) return;
  if (typeof window !== "undefined") return;
  if (!redis) {
    logger.warn("[wal] Redis not available, WAL worker disabled");
    return;
  }
  workerStarted = true;

  const { readyTimeoutMs = 60000, idleBackoffMs = 1000 } = opts;
  const consumer = `wal-worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

  const waitPersistenceReady = async (): Promise<Persistence | null> => {
    const start = Date.now();
    while (Date.now() - start < readyTimeoutMs) {
      // 动态引入避免循环依赖（storage.ts 依赖本模块的 writeState 场景）
      const { persistencePostgresql } = await import("@storage/storage.js");
      if (
        persistencePostgresql &&
        persistencePostgresql.provider &&
        persistencePostgresql.provider.pool
      ) {
        return persistencePostgresql;
      }
      await sleep(200);
    }
    logger.error("[wal] WAL worker start timeout: persistence not ready");
    return null;
  };

  const loop = async () => {
    const persistence = await waitPersistenceReady();
    if (!persistence) {
      logger.error("[wal] WAL worker aborted");
      return;
    }
    logger.info(`[wal] WAL worker started, consumer=${consumer}`);
    while (true) {
      try {
        await drainStreamsOnce(consumer);
      } catch (e: any) {
        logger.error("[wal] worker loop error", e);
      }
      await sleep(idleBackoffMs);
    }
  };

  loop().catch((e) => logger.error("[wal] WAL worker crashed", e));
};

/**
 * 等待某文档的 WAL 消费完成。
 * 需同时满足 XPENDING == 0、消费组 lag == 0（或 last-delivered-id 覆盖 stream 末条），
 * 否则未投递的 entry 可能被 XTRIM 丢弃。
 * 消费组不存在（未创建或已销毁）时，只要 stream 为空即视为排空。
 * 供 writeState / waitDocUpdateStable / 编译前强一致使用。
 * 返回 false 表示超时仍未排空。
 */
const streamIdParts = (value: unknown): [bigint, bigint] | null => {
  const match = /^(\d+)-(\d+)$/.exec(String(value));
  if (!match) return null;
  return [BigInt(match[1]), BigInt(match[2])];
};

const compareStreamIds = (
  left: unknown,
  right: unknown
): number | null => {
  const leftParts = streamIdParts(left);
  const rightParts = streamIdParts(right);
  if (!leftParts || !rightParts) return null;
  if (
    leftParts[0] < rightParts[0] ||
    (leftParts[0] === rightParts[0] && leftParts[1] < rightParts[1])
  ) {
    return -1;
  }
  if (
    leftParts[0] > rightParts[0] ||
    (leftParts[0] === rightParts[0] && leftParts[1] > rightParts[1])
  ) {
    return 1;
  }
  return 0;
};

const findConsumerGroup = (groups: unknown): Record<string, any> | null => {
  if (!Array.isArray(groups)) return null;
  for (const raw of groups) {
    if (Array.isArray(raw)) {
      const fields: Record<string, any> = {};
      for (let index = 0; index + 1 < raw.length; index += 2) {
        fields[String(raw[index])] = raw[index + 1];
      }
      if (String(fields.name) === GROUP) return fields;
    } else if (raw && typeof raw === "object") {
      const fields = raw as Record<string, any>;
      if (String(fields.name) === GROUP) return fields;
    }
  }
  return null;
};

export const waitDocWALDrained = async (
  docName: string,
  timeoutMs: number = 30000
): Promise<boolean> => {
  if (!redis || typeof window !== "undefined") return true;
  const stream = walStreamName(docName);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    let pendingCount: number;
    try {
      const pending = await redis.xpending(stream, GROUP);
      pendingCount = Array.isArray(pending) ? Number(pending[0] ?? 0) : 0;
    } catch (e: any) {
      if (String(e?.message || e).indexOf("NOGROUP") !== -1) {
        try {
          if ((await redis.xlen(stream)) === 0) return true;
        } catch (innerError) {
          void innerError;
        }
      }
      await sleep(200);
      continue;
    }

    if (pendingCount !== 0) {
      await sleep(200);
      continue;
    }

    let group: Record<string, any> | null = null;
    try {
      group = findConsumerGroup(await redis.xinfo("GROUPS", stream));
    } catch (e: any) {
      if (String(e?.message || e).indexOf("NOGROUP") === -1) {
        void e;
      }
    }

    if (!group) {
      try {
        if ((await redis.xlen(stream)) === 0) return true;
      } catch (e) {
        void e;
      }
      await sleep(200);
      continue;
    }

    const lagValue = group.lag;
    if (lagValue !== undefined && lagValue !== null) {
      const lag = Number(lagValue);
      if (Number.isFinite(lag) && lag > 0) {
        await sleep(200);
        continue;
      }
      if (Number.isFinite(lag) && lag === 0) return true;
    }

    const lastEntry = (await redis.xrevrange(
      stream,
      "+",
      "-",
      "COUNT",
      1
    )) as unknown as Array<[string, string[]]>;
    const comparison = compareStreamIds(
      lastEntry?.[0]?.[0],
      group["last-delivered-id"]
    );
    if (lastEntry.length === 0 || (comparison !== null && comparison <= 0)) {
      return true;
    }
    await sleep(200);
  }
  return false;
};