import { getRedisClient } from "@/storage/adapter/postgresql/conf/database_init.js";
import type Redis from "ioredis";
import logger from "@common/log4js_config.js";

const redis: Redis | null = getRedisClient();

export const getRedisDestriLock = async (
  lockKey: string,
  uniqueValue: string,
  times: number
) : Promise<boolean> => {
  // If Redis is not available (non-Node environment), pretend we got the lock
  if (!redis) {
    logger.info("Redis client not available, simulating lock acquisition", redis);
    return true;
  }

  if (times > 15) {
    logger.error("could not get lock wih 15 times retry");
    return false;
  }
  const waitTime = Math.min(200 * Math.pow(1.5, times), 2000);
  const result = await redis.set(lockKey, uniqueValue, "PX", 30000, "NX");
  if (result === "OK") {
    logger.warn(
      `[x] 获取锁 ${lockKey}, expected=${uniqueValue}，result=${result}`
    );
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
      }次重试，currentValue=${currentValue}, expected=${uniqueValue}，result=${result}`
    );
    await sleep(waitTime);
    return getRedisDestriLock(lockKey, uniqueValue, times + 1);
  }
};

function sleep(delay: number) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * 释放锁
 * @param resourceKey 资源键名
 * @param uniqueValue 唯一值，用于验证锁的所有者(建议:UUID)
 * @returns 是否成功释放锁
 */
export async function unlock(lockKey: string, uniqueValue: string) {
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
  const luaScript = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      else
        return 0
      end
    `;
  const result = await redis.eval(luaScript, 1, lockKey, uniqueValue);
  if (result === 1) {
  } else {
    logger.error(
      `release lock failed: ${lockKey}, currentValue=${currentValue}, expected=${uniqueValue}`
    );
  }
}
