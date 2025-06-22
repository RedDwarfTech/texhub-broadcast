import logger from "@common/log4js_config.js";
import { initializeDatabases, waitForDatabases, getDatabaseStatus } from "./database_init.js";

/**
 * Initialize all database connections at application startup
 * This should be called early in the application lifecycle
 */
export const initializeStorage = async (): Promise<void> => {
  try {
    logger.info("Initializing storage layer...");
    
    // Initialize databases
    await initializeDatabases();
    
    // Wait for initialization to complete
    await waitForDatabases();
    
    // Log status
    const status = getDatabaseStatus();
    logger.info("Storage initialization completed:", status);
    
  } catch (error) {
    logger.error("Storage initialization failed:", error);
    throw error;
  }
};

/**
 * Graceful shutdown of storage layer
 */
export const shutdownStorage = async (): Promise<void> => {
  try {
    logger.info("Shutting down storage layer...");
    
    const { closeDatabases } = await import("./database_init.js");
    await closeDatabases();
    
    logger.info("Storage shutdown completed");
  } catch (error) {
    logger.error("Storage shutdown failed:", error);
    throw error;
  }
};

/**
 * Get current storage status
 */
export const getStorageStatus = () => {
  return getDatabaseStatus();
};

// Export for convenience
export { 
  initializeDatabases, 
  closeDatabases, 
  getDatabaseStatus, 
  waitForDatabases,
  isDatabasesInitialized 
} from "./database_init.js"; 