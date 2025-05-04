// This file provides browser-specific implementations or empty stubs
// for Node.js specific functionality

// Empty implementation for fulltext search that works in browser environments
export const updateFullsearch = async () => {
  console.log("MeiliSearch operations are not supported in browser environments");
  return;
};

// Empty implementations for PostgreSQL operations
export const getDocAllUpdates = async () => {
  console.log("PostgreSQL operations are not supported in browser environments");
  return [];
};

export const getPgUpdatesTrans = async () => {
  console.log("PostgreSQL operations are not supported in browser environments");
  return [];
};

export const getPgUpdates = async () => {
  console.log("PostgreSQL operations are not supported in browser environments");
  return [];
};

export const storeUpdate = async () => {
  console.log("PostgreSQL operations are not supported in browser environments");
  return 0;
};

export const readStateVector = async () => {
  console.log("PostgreSQL operations are not supported in browser environments");
  return { sv: null, clock: -1 };
};

// PostgreSQL持久化类的浏览器兼容实现
export class PostgresqlPersistance {
  constructor() {
    console.log("PostgresqlPersistance initialized in browser environment (limited functionality)");
  }

  async getYDoc(docName) {
    console.log("PostgreSQL operations are not supported in browser environments");
    // 导入Y模块并创建空文档
    try {
      const Y = await import('rdyjs');
      return new Y.Doc();
    } catch (err) {
      console.error("Failed to create Y.Doc in browser environment", err);
      // 返回一个空对象作为备用
      return {};
    }
  }

  flushDocument() {
    console.log("PostgreSQL operations are not supported in browser environments");
    return;
  }

  async getStateVector() {
    console.log("PostgreSQL operations are not supported in browser environments");
    return null;
  }

  async storeUpdateTrans() {
    console.log("PostgreSQL operations are not supported in browser environments");
    return;
  }

  async storeUpdate() {
    console.log("PostgreSQL operations are not supported in browser environments");
    return;
  }

  async storeUpdateWithSource() {
    console.log("PostgreSQL operations are not supported in browser environments");
    return;
  }

  async insertKeys() {
    console.log("PostgreSQL operations are not supported in browser environments");
    return;
  }

  async getDiff(docName, stateVector) {
    console.log("PostgreSQL operations are not supported in browser environments");
    try {
      const Y = await import('rdyjs');
      const ydoc = new Y.Doc();
      return Y.encodeStateAsUpdate(ydoc, stateVector);
    } catch (err) {
      console.error("Failed to create diff in browser environment", err);
      return new Uint8Array();
    }
  }
}

// Default export for compatibility
export default {
  updateFullsearch,
  getDocAllUpdates,
  getPgUpdatesTrans,
  getPgUpdates,
  storeUpdate,
  readStateVector,
  PostgresqlPersistance
}; 