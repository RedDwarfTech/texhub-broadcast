# PostgreSQL Storage Adapter

This module provides a unified database initialization and management system for PostgreSQL and Redis connections.

## Architecture

### Database Initialization (`database_init.ts`)
- **Centralized initialization**: All database connections are managed in one place
- **Auto-initialization**: Databases are automatically initialized when the module is loaded
- **Error handling**: Comprehensive error handling and logging
- **Environment detection**: Automatically skips initialization in browser environments

### Storage Layer (`init.ts`)
- **Application startup**: Provides functions for application-level initialization
- **Graceful shutdown**: Handles proper cleanup of database connections
- **Status monitoring**: Provides status information about database connections

## Usage

### 1. Application Startup

In your main application file (e.g., `app.ts` or `server.ts`):

```typescript
import { initializeStorage } from "./storage/adapter/postgresql/conf/init.js";

async function startApplication() {
  try {
    // Initialize storage layer first
    await initializeStorage();
    
    // Start your application
    // ...
  } catch (error) {
    console.error("Failed to start application:", error);
    process.exit(1);
  }
}

startApplication();
```

### 2. Application Shutdown

```typescript
import { shutdownStorage } from "./storage/adapter/postgresql/conf/init.js";

async function gracefulShutdown() {
  try {
    // Shutdown storage layer
    await shutdownStorage();
    
    // Other cleanup tasks
    // ...
  } catch (error) {
    console.error("Shutdown failed:", error);
  }
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
```

### 3. Using Database Connections

```typescript
import { getPgPool, getRedisClient } from "./storage/adapter/postgresql/conf/database_init.js";

// Get PostgreSQL connection
const pgPool = getPgPool();
if (pgPool) {
  const client = await pgPool.connect();
  try {
    const result = await client.query('SELECT * FROM your_table');
    // ...
  } finally {
    client.release();
  }
}

// Get Redis client
const redisClient = getRedisClient();
if (redisClient) {
  await redisClient.set('key', 'value');
  const value = await redisClient.get('key');
}
```

### 4. Status Monitoring

```typescript
import { getDatabaseStatus } from "./storage/adapter/postgresql/conf/database_init.js";

const status = getDatabaseStatus();
console.log("Database status:", status);
// Output: { postgresql: { initialized: true }, redis: { initialized: true }, inBrowser: false }
```

## Environment Variables

### PostgreSQL
```bash
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=postgres
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
```

### Redis
```bash
REDIS_URL=redis://localhost:6379
```

## Features

### 1. Unified Initialization
- Single point of initialization for all database connections
- Consistent error handling and logging
- Environment-aware initialization

### 2. Connection Pooling
- PostgreSQL connection pooling for better performance
- Automatic connection management
- Error recovery

### 3. Optional Redis
- Redis is optional and won't fail initialization if unavailable
- Graceful degradation when Redis is not available

### 4. Browser Compatibility
- Automatically detects browser environment
- Skips initialization in browser contexts
- Returns null for database clients in browser

### 5. Health Checks
- Connection testing during initialization
- Status monitoring functions
- Timeout handling

## Migration from Old System

### Before (Old way)
```typescript
// Each file had its own initialization logic
let pgPool: any = null;
let client: any = null;

if (typeof window === "undefined") {
  // Complex initialization logic...
}
```

### After (New way)
```typescript
// Simply import and use
import { getPgPool, getRedisClient } from "./conf/database_init.js";

const pgPool = getPgPool();
const redisClient = getRedisClient();
```

## Error Handling

The system provides comprehensive error handling:

1. **Initialization errors**: Logged and thrown for application-level handling
2. **Connection errors**: Logged and handled gracefully
3. **Timeout errors**: Configurable timeouts with clear error messages
4. **Environment errors**: Graceful handling of browser vs Node.js environments

## Best Practices

1. **Initialize early**: Call `initializeStorage()` early in your application startup
2. **Handle errors**: Always handle initialization errors appropriately
3. **Monitor status**: Use status functions to monitor database health
4. **Graceful shutdown**: Always call `shutdownStorage()` during application shutdown
5. **Environment variables**: Use environment variables for configuration
6. **Logging**: The system provides comprehensive logging for debugging

## Troubleshooting

### Common Issues

1. **"Pool is not a constructor"**
   - This is now handled by the unified initialization system
   - The system automatically detects the correct module export format

2. **Connection timeouts**
   - Check your environment variables
   - Verify database services are running
   - Check network connectivity

3. **Redis connection failures**
   - Redis is optional, so this won't break PostgreSQL functionality
   - Check REDIS_URL environment variable
   - Verify Redis service is running

### Debug Information

```typescript
import { getDatabaseStatus, waitForDatabases } from "./conf/database_init.js";

// Check status
const status = getDatabaseStatus();
console.log("Status:", status);

// Wait for initialization with timeout
try {
  await waitForDatabases(5000); // 5 second timeout
  console.log("Databases ready");
} catch (error) {
  console.error("Database initialization timeout:", error);
}
``` 