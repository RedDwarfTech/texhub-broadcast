import { getRedisClient } from "@/storage/adapter/postgresql/conf/database_init.js";
import type Redis from "ioredis";
import logger from "@common/log4js_config.js";
import { SyncFileAttr } from "@/model/texhub/sync_file_attr.js";

export const redis: Redis | undefined = await getRedisClient();

export const getRedisDestriLock = async (
  lockKey: string,
  uniqueValue: string,
  times: number,
  syncFileAttr: SyncFileAttr
): Promise<boolean> => {
  // If Redis is not available (non-Node environment), pretend we got the lock
  if (!redis) {
    logger.info(
      "Redis client not available, simulating lock acquisition",
      redis
    );
    return true;
  }

  if (times > 15) {
    logger.error("could not get lock wih 15 times retry");
    return false;
  }
  const waitTime = Math.min(200 * Math.pow(1.5, times), 2000);
  const result = await redis.set(lockKey, uniqueValue, "PX", 30000, "NX");
  if (result === "OK") {
    return true;
  } else {
    let currentValue: string | null = null;
    try {
      currentValue = await redis.get(lockKey);
    } catch (e) {
      logger.error(`Error getting current lock value for ${lockKey}:`, e);
    }
    logger.warn(
      `[x] 无法获取锁 ${lockKey}，第${
        times + 1
      }次重试，currentValue=${currentValue}, expected=${uniqueValue}，result=${result}, syncFileAttr=${JSON.stringify(
        syncFileAttr
      )}`
    );
    await sleep(waitTime);
    return getRedisDestriLock(lockKey, uniqueValue, times + 1, syncFileAttr);
  }
};

function sleep(delay: number) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * 释放锁
 * @param lockKey 资源键名
 * @param uniqueValue 唯一值，用于验证锁的所有者(建议:UUID)
 * @returns 是否成功释放锁
 */
export async function unlockDistriKey(lockKey: string, uniqueValue: string) {
  if (!redis) {
    logger.info("Redis client not available, simulating lock release", redis);
    return;
  }
  let currentValue: string | null = null;
  try {
    currentValue = await redis.get(lockKey);
  } catch (e) {
    logger.error(`Error getting current lock value for ${lockKey}:`, e);
  }
  if (currentValue === null) {
    logger.warn(`lockKey not exists, skip unlock: ${lockKey}, expected=${uniqueValue}`);
    return;
  }
  const luaScript = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      else
        return 0
      end
    `;
  const result = await redis.eval(luaScript, 1, lockKey, uniqueValue);
  if (result !== 1) {
    logger.error(
      `release lock failed: ${lockKey}, currentValue=${currentValue}, expected=${uniqueValue}`
    );
  }
}

export const getUpdateHashKey = (
  src: string,
  syncFileAttr: SyncFileAttr,
  updateHash: string
): string => src + `:updatehash:${syncFileAttr.docName}:${updateHash}`;

/**
 * 仅检查 update hash 是否已存在（不落标记）。
 * 用于幂等存储前判断"该内容是否已经成功落库"。
 */
export const isUpdateHashDuplicated = async (
  update: Uint8Array,
  syncFileAttr: SyncFileAttr,
  src: string
): Promise<boolean> => {
  let crypto;
  try {
    crypto = await import("crypto");
  } catch (e) {
    logger.error("crypto import failed", e);
    return false;
  }
  const updateHash = crypto.createHash("sha256").update(update).digest("hex");
  if (!redis) {
    // Redis 不可用时（非 Node 环境/降级），无状态可查，视为未重复
    return false;
  }
  const exists = await redis.get(
    getUpdateHashKey(src, syncFileAttr, updateHash)
  );
  if (exists) {
    logger.warn(
      src +
        ` 重复update内容，hash=${updateHash}，doc=${JSON.stringify(
          syncFileAttr
        )}，跳过存储`
    );
    return true;
  }
  return false;
};

/**
 * 标记 update hash 已存在。仅在"内容确认已成功写入 tex_sync 之后"调用，
 * 以保证 hash 标记 == 已持久化，重试不会误跳。
 */
export const markUpdateHash = async (
  update: Uint8Array,
  syncFileAttr: SyncFileAttr,
  src: string
): Promise<void> => {
  let crypto;
  try {
    crypto = await import("crypto");
  } catch (e) {
    logger.error("crypto import failed", e);
    return;
  }
  if (!redis) {
    return;
  }
  const updateHash = crypto.createHash("sha256").update(update).digest("hex");
  await redis.set(getUpdateHashKey(src, syncFileAttr, updateHash), "1", "EX", 30);
};

// 检查update hash是否已存在
export const checkAndMarkUpdateHash = async (
  update: Uint8Array,
  syncFileAttr: SyncFileAttr,
  src: string
): Promise<boolean> => {
  if (await isUpdateHashDuplicated(update, syncFileAttr, src)) {
    return true;
  }
  await markUpdateHash(update, syncFileAttr, src);
  return false;
};
