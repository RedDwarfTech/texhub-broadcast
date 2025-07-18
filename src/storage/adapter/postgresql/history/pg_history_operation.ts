//@ts-ignore
import * as Y from "rdyjs";
// @ts-ignore
import * as binary from "rdlib0/binary.js";
// @ts-ignore
import * as encoding from "rdlib0/encoding.js";
// @ts-ignore
import * as decoding from "rdlib0/decoding.js";
// 仅导入类型定义，避免在浏览器环境中导入实际模块
import type * as pg from "pg";
import type { QueryResult } from "pg";
import logger from "@common/log4js_config.js";
import {
  createDocumentStateVectorKey,
  createDocumentStateVectorKeyMap,
  createDocumentUpdateKey,
  createDocumentUpdateKeyArray,
  createSimpleDocumentStateVectorKeyMap,
} from "../conf/postgresql_const.js";
import { TeXSync } from "@model/yjs/storage/sync/tex_sync.js";
import { v4 as uuidv4 } from "uuid";
import { getPgPool, getRedisClient } from "../conf/database_init.js";
import { SyncFileAttr } from "@/model/texhub/sync_file_attr.js";

// 获取数据库客户端
const getClient = () => getRedisClient();

export const getHistoryDocAllUpdates = async (
  db: pg.Pool,
  docName: string,
  opts = { values: true, keys: false, reverse: false }
) => {
  if (typeof window !== "undefined") {
    return [];
  }

  return await getPgBulkData(
    {
      gte: createDocumentUpdateKey(docName, 0),
      lt: createDocumentUpdateKey(docName, binary.BITS32),
      ...opts,
    },
    docName
  );
};

export const getPgUpdatesTrans = async (
  db: pg.PoolClient,
  docName: string,
  opts = { values: true, keys: false, reverse: false, limit: 1 }
) => {
  return await getPgBulkDataTrans(
    db,
    {
      gte: createDocumentUpdateKey(docName, 0),
      lt: createDocumentUpdateKey(docName, binary.BITS32),
      ...opts,
    },
    docName
  );
};

export const getPgUpdates = async (
  docName: string,
  opts = { values: true, keys: false, reverse: false, limit: 1 }
) => {
  return await getPgBulkData(
    {
      gte: createDocumentUpdateKey(docName, 0),
      lt: createDocumentUpdateKey(docName, binary.BITS32),
      ...opts,
    },
    docName
  );
};

export const getPgBulkDataTrans = async (
  db: pg.PoolClient,
  opts: any,
  docName: string
) => {
  try {
    let col = [];
    col.push("id");
    col.push("clock");
    if (opts.values) {
      col.push("value");
    }
    if (opts.keys) {
      col.push("key");
    }
    let col_concat = col.join(",");
    const queryPart = "select " + col_concat;
    const fromPart = " from tex_sync_history ";
    const filterPart =
      " where doc_name = '" +
      docName +
      "' and content_type='" +
      opts.gte.get("contentType") +
      "' and clock>=0 and clock <" +
      binary.BITS32;
    let orderPart = " order by clock asc";
    if (opts.reverse) {
      orderPart = " order by clock desc";
    }
    let limitPart = "";
    if (opts.limit) {
      limitPart = " limit " + opts.limit;
    }
    const sql = queryPart + fromPart + filterPart + orderPart + limitPart;
    let result: QueryResult<TeXSync> = await db.query(sql);
    return result.rows;
  } catch (err) {
    console.error("Query error:", err);
    throw err;
  }
};

export const getPgBulkData = async (opts: any, docName: string) => {
  try {
    let col = [];
    col.push("id");
    col.push("clock");
    if (opts.values) {
      col.push("value");
    }
    if (opts.keys) {
      col.push("key");
    }
    let col_concat = col.join(",");
    const queryPart = "select " + col_concat;
    const fromPart = " from tex_sync_history ";
    const filterPart =
      " where doc_name = '" +
      docName +
      "' and content_type='" +
      opts.gte.get("contentType") +
      "' and clock>=0 and clock <" +
      binary.BITS32;
    let orderPart = " order by clock asc";
    if (opts.reverse) {
      orderPart = " order by clock desc";
    }
    let limitPart = "";
    if (opts.limit) {
      limitPart = " limit " + opts.limit;
    }
    const sql = queryPart + fromPart + filterPart + orderPart + limitPart;
    let sysDb = getPgPool();
    let result: QueryResult<TeXSync> = await sysDb!.query(sql);
    return result.rows;
  } catch (err) {
    logger.error("Query error:", err);
  }
  return [];
};

export const mergeUpdates = (updates: any) => {
  const ydoc = new Y.Doc();
  ydoc.transact(() => {
    for (let i = 0; i < updates.length; i++) {
      Y.applyUpdate(ydoc, updates[i]);
    }
  });
  return { update: Y.encodeStateAsUpdate(ydoc), sv: Y.encodeStateVector(ydoc) };
};

export const flushDocument = async (
  db: pg.Pool,
  stateAsUpdate: any,
  stateVector: any,
  syncFileAttr: SyncFileAttr
) => {
  let docName = syncFileAttr.docName;
  const clock = await storeHistoryUpdate(syncFileAttr, stateAsUpdate);
  await writeStateVector(syncFileAttr, stateVector, clock);
  await clearUpdatesRange(db, docName, 0, clock); // intentionally not waiting for the promise to resolve!
  return clock;
};

const getLock = async (lockKey: string, uniqueValue: string, times: number) => {
  // If Redis is not available (non-Node environment), pretend we got the lock
  if (!getClient()) {
    logger.info("Redis client not available, simulating lock acquisition");
    return true;
  }

  if (times > 15) {
    logger.error("could not get lock wih 15 times retry");
    return false;
  }
  const waitTime = Math.min(200 * Math.pow(1.5, times), 2000);
  // the expire time is seconds
  const expireTime = 5;
  const luaScript = `
    if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', ARGV[2]) then
      return 1
    else
      return 0
    end
    `;
  const result = await getClient()!.eval(luaScript, {
    keys: [lockKey],
    arguments: [uniqueValue, `${expireTime}`],
  });
  if (result === 1) {
    return true;
  } else {
    logger.warn(`[x] 无法获取锁history ${lockKey}，第${times + 1}次重试`);
    await sleep(waitTime);
    return getLock(lockKey, uniqueValue, times + 1);
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
async function unlock(lockKey: string, uniqueValue: string) {
  // If Redis is not available (non-Node environment), do nothing
  if (!getClient()) {
    logger.info("Redis client not available, simulating lock release");
    return;
  }

  const luaScript = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    else
      return 0
    end
  `;
  const result = await getClient()!.eval(luaScript, {
    keys: [lockKey],
    arguments: [uniqueValue],
  });
  if (result === 1) {
  }
}

export const storeUpdateTrans = async (
  db: pg.PoolClient,
  docName: string,
  update: Uint8Array
) => {
  console.time("getlock");
  const clock = await getCurrentUpdateClockTrans(db, docName);
  console.timeEnd("getlock");
  if (clock === -1) {
    // make sure that a state vector is aways written, so we can search for available documents
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, update);
    const sv = Y.encodeStateVector(ydoc);
    await writeStateVectorTrans(db, docName, sv, 0);
  }
  await pgPutTrans(
    db,
    update,
    "ws",
    createDocumentUpdateKeyArray(docName, clock + 1)
  );
  return clock + 1;
};

export const storeHistoryUpdate = async (
  syncFileAttr: SyncFileAttr,
  update: Uint8Array
) => {
  const uniqueValue = uuidv4();
  let docName = syncFileAttr.docName;
  const lockKey = `hist-lock:${docName}:update`;
  try {
    // Attempt to get lock (will always succeed if Redis is not available)
    if (await getLock(lockKey, uniqueValue, 0)) {
      const clock = await getCurrentUpdateClock(docName);
      if (clock === -1) {
        // make sure that a state vector is aways written, so we can search for available documents
        const ydoc = new Y.Doc();
        Y.applyUpdate(ydoc, update);
        const sv = Y.encodeStateVector(ydoc);
        await writeStateVector(syncFileAttr, sv, 0);
      }
      await pgHistoryPut(
        update,
        "ws",
        createDocumentUpdateKeyArray(docName, clock + 1),
        syncFileAttr
      );
      return clock + 1;
    }
  } catch (error: any) {
    logger.error(`Error in storeUpdate: ${error.message || error}`);
  } finally {
    // release lock (will do nothing if Redis is not available)
    await unlock(lockKey, uniqueValue);
  }
  return 0;
};

export const storeUpdateBySrc = async (
  update: Uint8Array,
  keys: any[],
  syncFileAttr: SyncFileAttr
) => {
  await pgHistoryPut(update, "leveldb", keys, syncFileAttr);
};

export const insertKey = async (
  db: pg.Pool,
  keyMap: any[],
  originalKey: any[]
) => {
  await pgPutKey(db, keyMap, originalKey);
};

const writeStateVectorTrans = async (
  db: pg.PoolClient,
  docName: string,
  sv: any,
  clock: number
) => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, clock);
  encoding.writeVarUint8Array(encoder, sv);
  await pgPutUpsertTrans(
    db,
    createDocumentStateVectorKeyMap(docName, clock),
    encoding.toUint8Array(encoder),
    "ws",
    createDocumentStateVectorKey(docName)
  );
};

const writeStateVector = async (
  syncFileAttr: SyncFileAttr,
  sv: any,
  clock: number
) => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, clock);
  encoding.writeVarUint8Array(encoder, sv);
  let docName = syncFileAttr.docName;
  await pgPutUpsert(
    createDocumentStateVectorKeyMap(docName, clock),
    encoding.toUint8Array(encoder),
    "ws",
    createDocumentStateVectorKey(docName),
    syncFileAttr.projectId
  );
};

const pgGet = async (
  db: pg.Pool,
  key: Map<string, string>
): Promise<Uint8Array> => {
  let res: QueryResult<TeXSync>;
  try {
    let sql = `select value from tex_sync_history where key = $1`;
    let mapValues = key.values();
    const array = Array.from(mapValues);
    const values = [JSON.stringify(array)];
    res = await db.query(sql, values);
    if (res.rowCount === 0) {
      return new Uint8Array();
    }
    return res.rows[0].value;
  } catch (err) {
    /* istanbul ignore else */
    if (err) {
      return new Uint8Array();
    } else {
      throw err;
    }
  }
};

const pgPutKey = async (db: pg.Pool, key: any[], originalKey: any[]) => {
  try {
    const query = `INSERT INTO tex_keys (key, origin_key) 
      VALUES ($1,$2) `;
    const values = [JSON.stringify(key), JSON.stringify(originalKey)];
    const res: pg.QueryResult<any> = await db.query(query, values);
  } catch (err: any) {
    logger.error("Insert keys error:", err.stack);
  }
};

const pgPutTrans = async (
  db: pg.PoolClient,
  val: Uint8Array,
  source: string,
  keys: any[]
) => {
  try {
    const query = `INSERT INTO tex_sync_history (key, value, version, content_type, doc_name, clock, source) 
      VALUES ($1, $2, $3, $4, $5, $6, $7) `;
    let version = keys[0];
    let contentType = keys[2] || "default";
    let docName = keys[1];
    let clock = keys[3] || 0;
    const values = [
      JSON.stringify(keys),
      Buffer.from(val),
      version,
      contentType,
      docName,
      clock,
      source,
    ];
    const res: pg.QueryResult<any> = await db.query(query, values);
  } catch (err: any) {
    logger.error(
      "pgPutTrans insert tex sync record error:" +
        JSON.stringify(keys) +
        ",val:" +
        val,
      err.stack
    );
  }
};

const pgHistoryPut = async (
  val: Uint8Array,
  source: string,
  keys: any[],
  syncFileAttr: SyncFileAttr
) => {
  try {
    // we think there is no need to use on conflict do update
    // it is impossible to conflict with the key
    const query = `INSERT INTO tex_sync_history(key, value, version, content_type, doc_name, clock, source, project_id) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) `;
    // on conflict do update
    // const query = `INSERT INTO tex_sync (key, value, version, content_type, doc_name, clock, source)
    //   VALUES ($1, $2, $3, $4, $5, $6, $7)
    //   ON CONFLICT (key) DO UPDATE
    //  SET value = $2, version = $3, content_type = $4, doc_name = $5, clock = $6, source = $7`;

    let version = keys[0];
    let contentType = keys[2] || "default";
    let docName = keys[1];
    let clock = keys[3] || 0;

    const values = [
      JSON.stringify(keys),
      Buffer.from(val),
      version,
      contentType,
      docName,
      clock,
      source,
      syncFileAttr.projectId,
    ];
    let sysDb = getPgPool();
    const res: pg.QueryResult<any> = await sysDb!.query(query, values);
    return res;
  } catch (err: any) {
    logger.error(
      "pgPut insert/update tex sync record error:" +
        JSON.stringify(keys) +
        ",val:" +
        val,
      err.stack
    );
    throw err;
  }
};

const pgPutUpsertTrans = async (
  db: pg.PoolClient,
  key: Map<string, string>,
  val: Uint8Array,
  source: string,
  keys: any[]
) => {
  try {
    const query = `INSERT INTO tex_sync_history (key, value, version, content_type, doc_name, clock, source) 
      VALUES ($1, $2, $3 $4, $5, $6, $7) `;
    let version = key.get("version") || "default";
    let contentType = key.get("contentType") || "default";
    let docName = key.get("docName") ? key.get("docName") : "default";
    let clock = key.get("clock") ? key.get("clock") : -1;
    // https://stackoverflow.com/questions/1347646/postgres-error-on-insert-error-invalid-byte-sequence-for-encoding-utf8-0x0
    const values = [
      JSON.stringify(keys),
      Buffer.from(val),
      version,
      contentType,
      docName,
      clock,
      source,
    ];
    const res: pg.QueryResult<any> = await db.query(query, values);
  } catch (err: any) {
    logger.error(
      "Insert pgPutUpsertTrans error:" + JSON.stringify(keys),
      err.stack
    );
  }
};

const pgPutUpsert = async (
  key: Map<string, string>,
  val: Uint8Array,
  source: string,
  keys: any[],
  project_id: string
) => {
  try {
    const query = `INSERT INTO tex_sync_history (key, value, version, content_type, doc_name, clock, source, project_id) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) `;
    let version = key.get("version") || "default";
    let contentType = key.get("contentType") || "default";
    let docName = key.get("docName") ? key.get("docName") : "default";
    let clock = key.get("clock") ? key.get("clock") : -1;
    const values = [
      JSON.stringify(keys),
      Buffer.from(val),
      version,
      contentType,
      docName,
      clock,
      source,
      project_id,
    ];
    let sysDb = getPgPool();
    const res: pg.QueryResult<any> = await sysDb!.query(query, values);
  } catch (err: any) {
    logger.error(
      "Insert pgPutUpsert history error:" + JSON.stringify(keys),
      err.stack
    );
  }
};

export const getCurrentUpdateClockTrans = async (
  db: pg.PoolClient,
  docName: string
): Promise<number> => {
  const result: any[] = await getPgUpdatesTrans(db, docName, {
    keys: true,
    values: false,
    reverse: true,
    limit: 1,
  });
  if (result && result.length > 0) {
    return result[0].clock;
  } else {
    // the document does not exist yet.
    return -1;
  }
};

export const getCurrentUpdateClock = async (
  docName: string
): Promise<number> => {
  const result: any[] = await getPgUpdates(docName, {
    keys: true,
    values: false,
    reverse: true,
    limit: 1,
  });
  if (result && result.length > 0) {
    return result[0].clock;
  } else {
    // the document does not exist yet.
    return -1;
  }
};

const clearUpdatesRange = async (
  db: pg.Pool,
  docName: string,
  from: number,
  to: number
) => clearRange(db, docName, from, to);

const clearRange = async (
  db: pg.Pool,
  docName: string,
  from: number,
  to: number
) => {
  try {
    const query = `delete from tex_sync_history where doc_name = $1 and content_type=$2 and clock >= $3 and clock < $4`;
    const values = [docName, "update", from, to];
    const res: pg.QueryResult<any> = await db.query(query, values);
  } catch (err) {
    logger.error("clear error", err);
  }
};

export const readStateVector = async (db: pg.Pool, docName: string) => {
  const buf: Uint8Array = await pgGet(
    db,
    createSimpleDocumentStateVectorKeyMap(docName)
  );
  if (buf === null) {
    // no state vector created yet or no document exists
    return { sv: null, clock: -1 };
  }
  return decodePgStateVector(buf);
};

const decodePgStateVector = (buf: Uint8Array) => {
  const decoder = decoding.createDecoder(buf);
  const clock = decoding.readVarUint(decoder);
  const sv = decoding.readVarUint8Array(decoder);
  return { sv, clock };
};
