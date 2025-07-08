import type * as pg from "pg";
import logger from "@common/log4js_config.js";
import { isDatabasesInitialized } from "./database_init.js";

/**
 * Close PostgreSQL connection pool
 * @deprecated Use closeDatabases from database_init.js instead
 */
export const closePgPool = async (): Promise<void> => {
  // This function is kept for backward compatibility
  // The actual closing is handled by closeDatabases in database_init.js
  logger.warn("closePgPool is deprecated. Use closeDatabases from database_init.js instead");
};

/**
 * Check if PostgreSQL pool is initialized
 * @deprecated Use isDatabasesInitialized from database_init.js instead
 */
export const isPgPoolInitialized = (): boolean => {
  return isDatabasesInitialized();
};

/**
 * Get PostgreSQL pool status
 * @deprecated Use getDatabaseStatus from database_init.js instead
 */
export const getPgPoolStatus = (): { initialized: boolean; inBrowser: boolean } => {
  const status = isDatabasesInitialized();
  return {
    initialized: status,
    inBrowser: typeof window !== 'undefined'
  };
};
