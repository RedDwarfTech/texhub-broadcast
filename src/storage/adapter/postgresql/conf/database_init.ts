import type * as pg from "pg";
import logger from "@common/log4js_config.js";
import type Redis from "ioredis";

let pgPool: pg.Pool | null = null;
let redisClient: any = null;

const pgConfig = {
  host: process.env.PG_HOST || "localhost",
  port: parseInt(process.env.POSTGRES_PORT || "5432"),
  database: process.env.PG_YJS_DATABASE || "yjs",
  user: process.env.PG_USER || "postgres",
  password: process.env.PG_PASSWORD || "postgres",
};

/**
 * Initialize PostgreSQL connection pool
 */
const initializePostgreSQL = async (): Promise<void> => {
  try {
    const pgModule = await import("pg");
    // Handle different module export formats
    const Pool = pgModule.default?.Pool || pgModule.Pool;
    if (!Pool) {
      throw new Error("Pool constructor not found in pg module");
    }

    pgPool = new Pool(pgConfig);
    pgPool.on("error", (err: Error) => {
      logger.error("Unexpected error on idle PostgreSQL client", err);
    });

    // Test the connection
    const client = await pgPool.connect();
    await client.query("SELECT 1");
    client.release();

    logger.info("PostgreSQL connection pool initialized successfully");
  } catch (error) {
    logger.error("Failed to initialize PostgreSQL connection pool:", error);
    throw error;
  }
};

/**
 * Initialize Redis client
 */
const initializeRedis = async (): Promise<Redis | undefined> => {
  try {
    let Redis: any = null;
    Redis = (await import("ioredis")).default;
    let redisClient: Redis = new Redis({
      host: "reddwarf-redis-master.reddwarf-cache.svc.cluster.local",
      port: 6379,
      username: "default",
      password: process.env.REDIS_PASSWORD || "redis",
      db: 1,
    });
    logger.info("Redis client initialized successfully");
    return redisClient;
  } catch (error) {
    logger.error("Failed to initialize Redis client:", error);
    // Redis is optional, so we don't throw error
  }
};

/**
 * Initialize all database connections
 */
export const initializeDatabases = async (): Promise<void> => {
  if (typeof window !== "undefined") {
    logger.info("Skipping database initialization in browser environment");
    return;
  }
  try {
    // Initialize PostgreSQL
    await initializePostgreSQL();
    logger.info("Database initialization completed successfully");
  } catch (error) {
    logger.error("Database initialization failed:", error);
    throw error;
  }
};

/**
 * Get PostgreSQL connection pool
 */
export const getPgPool = (): pg.Pool | null => {
  if (typeof window !== "undefined") {
    return null;
  }
  return pgPool;
};

/**
 * Get Redis client
 */
export const getRedisClient = async (): Promise<Redis | undefined> => {
  if (typeof window !== "undefined") {
    return;
  }
  return await initializeRedis();
};

/**
 * Close all database connections
 */
export const closeDatabases = async (): Promise<void> => {
  if (typeof window !== "undefined") {
    return;
  }

  try {
    // Close PostgreSQL pool
    if (pgPool) {
      await pgPool.end();
      pgPool = null;
      logger.info("PostgreSQL pool closed successfully");
    }

    // Close Redis client
    if (redisClient) {
      await redisClient.quit();
      logger.info("Redis client closed successfully");
    }
  } catch (error) {
    logger.error("Error closing database connections:", error);
  }
};

/**
 * Check if databases are initialized
 */
export const isDatabasesInitialized = (): boolean => {
  return pgPool !== null;
};

/**
 * Get database status
 */
export const getDatabaseStatus = (): {
  postgresql: { initialized: boolean };
  redis: { initialized: boolean };
  inBrowser: boolean;
} => {
  return {
    postgresql: { initialized: pgPool !== null },
    redis: { initialized: redisClient !== null },
    inBrowser: typeof window !== "undefined",
  };
};

/**
 * Wait for database initialization
 */
export const waitForDatabases = async (
  timeout: number = 30000
): Promise<void> => {
  if (typeof window !== "undefined") {
    return;
  }

  const startTime = Date.now();
  while (!isDatabasesInitialized() && Date.now() - startTime < timeout) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (!isDatabasesInitialized()) {
    throw new Error("Database initialization timeout");
  }
};

// Auto-initialize databases when module is loaded (only in Node.js environment)
if (typeof window === "undefined") {
  initializeDatabases().catch((error) => {
    logger.error("Auto-initialization failed:", error);
  });
}
