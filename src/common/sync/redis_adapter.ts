import { createAdapter } from "@socket.io/redis-adapter";
import { websocketServer } from "@/app.js";
import { redis } from "@/common/cache/redis_util.js";
import logger from "@common/log4js_config.js";

let adapterReady = false;

/**
 * P1（docs/design/message-reliable.md §6.1）：Socket.IO Redis Adapter。
 * - pub/sub 两客户端必须"同一连接的 duplicate"：用现有 ioredis 连接做 publish，
 *   duplicate() 出独立连接专用于 subscribe（ioredis 订阅后会进入 subscriber 模式，
 *   不宜复用业务连接）。
 * - 一旦挂上 adapter，`io.to(room).emit` 会经 Redis 频道路由到所有实例，本实例成员
 *   依旧直发（不回环 Redis），跨实例成员由对方实例直发。
 * - Redis 不可用（非 Node 环境/初始化失败）则跳过：保持单副本本地广播语义，广播
 *   room 内本实例连接即可。
 * - 必须在 Server 实例化之后、任何 socket 连接之前调用（app.ts initialize 首行）。
 *   adapterReady 通过 module scope 保证只初始化一次。
 */
export const initRedisAdapter = (): void => {
  if (adapterReady || typeof window !== "undefined") return;
  if (!redis) {
    logger.warn(
      "[redis-adapter] Redis client not available, fallback to single-instance broadcast"
    );
    return;
  }
  try {
    const subClient = redis.duplicate();
    websocketServer.adapter(
      createAdapter(redis, subClient, {
        key: "texhub:sync:pubsub",
        requestsTimeout: 10000,
      })
    );
    adapterReady = true;
    logger.info(
      "[redis-adapter] Socket.IO Redis adapter initialized for cross-instance broadcast"
    );
  } catch (e: any) {
    logger.error("[redis-adapter] init failed, fallback to single-instance", e);
    adapterReady = false;
  }
};

export const isRedisAdapterReady = (): boolean => adapterReady;