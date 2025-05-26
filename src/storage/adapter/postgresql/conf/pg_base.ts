import type * as pg from "pg";
import logger from "@common/log4js_config.js";
import { dbConfig } from "./db_config.js";

let pgPool: pg.Pool | null = null;

// Initialize pool at module level
if (typeof window === 'undefined') {
  (async () => {
    try {
      const pgModule = await import('pg');
      const { Pool } = pgModule.default || pgModule;
      const pool = new Pool(dbConfig);
      pool.on('error', (err: Error) => {
        logger.error('Unexpected error on idle client', err);
      });
      pgPool = pool;
    } catch (error) {
      logger.error("Failed to initialize PostgreSQL pool:", error);
    }
  })();
}

export const getPgPool = (): pg.Pool | null => {
  if (typeof window !== 'undefined') {
    return null;
  }
  return pgPool;
};

export const closePgPool = async (): Promise<void> => {
  if (typeof window !== 'undefined' || !pgPool) {
    return;
  }

  try {
    await pgPool.end();
    pgPool = null;
    logger.info("PostgreSQL pool closed successfully");
  } catch (error) {
    logger.error("Error closing PostgreSQL pool:", error);
  }
};

export const isPgPoolInitialized = (): boolean => {
  return pgPool !== null;
};

export const getPgPoolStatus = (): { initialized: boolean; inBrowser: boolean } => {
  return {
    initialized: pgPool !== null,
    inBrowser: typeof window !== 'undefined'
  };
};
