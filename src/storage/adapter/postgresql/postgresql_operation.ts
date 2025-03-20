//@ts-ignore
import * as Y from "yjs";
import * as binary from "lib0/binary.js";
import * as encoding from "lib0/encoding.js";
import * as decoding from "lib0/decoding.js";
import pg, { QueryResult } from "pg";
import logger from "../../../common/log4js_config.js";
import {
  createDocumentStateVectorKey,
  createDocumentStateVectorKeyMap,
  createDocumentUpdateKey,
  createDocumentUpdateKeyArray,
  createSimpleDocumentStateVectorKeyMap,
} from "./postgresql_const.js";
import { TeXSync } from "../../../model/yjs/storage/sync/tex_sync.js";
import { createClient } from "redis";
import { v4 as uuidv4 } from "uuid";

const client = await createClient({
  url: process.env.REDIS_URL,
})
  .on("error", (err) => logger.error("Redis Client Error", err))
  .connect();

export const getDocAllUpdates = async (
  db: pg.Pool,
  docName: string,
  opts = { values: true, keys: false, reverse: false }
) => {
  return await getPgBulkData(
    db,
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
  db: pg.Pool,
  docName: string,
  opts = { values: true, keys: false, reverse: false, limit: 1 }
) => {
  return await getPgBulkData(
    db,
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
    const fromPart = " from tex_sync ";
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

export const getPgBulkData = async (
  db: pg.Pool,
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
    const fromPart = " from tex_sync ";
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
  docName: string,
  stateAsUpdate: any,
  stateVector: any
) => {
  const clock = await storeUpdate(db, docName, stateAsUpdate);
  await writeStateVector(db, docName, stateVector, clock);
  await clearUpdatesRange(db, docName, 0, clock); // intentionally not waiting for the promise to resolve!
  return clock;
};

const getLock = async (docName: string, uniqueValue: string, times: number) => {
  if (times > 15) {
    logger.error("could not get lock wih 15 times retry");
    return false;
  }
  const lockKey = `lock:${docName + "-update"}`;
  const expireTime = 5000;
  // Lua脚本用于原子获取锁
  const luaScript = `
    if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', ARGV[2]) then
      return 1
    else
      return 0
    end
    `;
  // 执行Lua脚本
  const result = await client.eval(luaScript, {
    keys: [lockKey],
    arguments: [uniqueValue, `${expireTime}`],
  });
  if (result === 1) {
    return true;
  } else {
    logger.warn(`[x] 无法获取锁 ${lockKey}`);
    await sleep(1000);
    return getLock(docName, uniqueValue, times + 1);
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
async function unlock(docName: string, uniqueValue: string) {
  const lockKey = `lock:${docName + "-update"}`;
  const luaScript = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    else
      return 0
    end
  `;
  const result = await client.eval(luaScript, {
    keys: [lockKey],
    arguments: [uniqueValue],
  });

  if (result === 1) {
  } else {
    logger.error("[x] 锁释放失败，可能锁已经被其他客户端更新");
  }
}

export const storeUpdateTrans = async (
  db: pg.PoolClient,
  docName: string,
  update: Uint8Array
) => {
  const uniqueValue = uuidv4();
  try {
    if (await getLock(docName, uniqueValue, 0)) {
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
    }
  } catch (error: any) {
    logger.error(error);
  } finally {
    // release lock
    unlock(docName, uniqueValue);
  }
  return 0;
};

export const storeUpdate = async (
  db: pg.Pool,
  docName: string,
  update: Uint8Array
) => {
  const uniqueValue = uuidv4();
  try {
    if (await getLock(docName, uniqueValue, 0)) {
      console.time("getlock");
      const clock = await getCurrentUpdateClock(db, docName);
      console.timeEnd("getlock");
      if (clock === -1) {
        // make sure that a state vector is aways written, so we can search for available documents
        const ydoc = new Y.Doc();
        Y.applyUpdate(ydoc, update);
        const sv = Y.encodeStateVector(ydoc);
        await writeStateVector(db, docName, sv, 0);
      }
      await pgPut(
        db,
        update,
        "ws",
        createDocumentUpdateKeyArray(docName, clock + 1)
      );
      return clock + 1;
    }
  } catch (error: any) {
    logger.error(error);
  } finally {
    // release lock
    unlock(docName, uniqueValue);
  }
  return 0;
};

export const storeUpdateBySrc = async (
  db: pg.Pool,
  update: Uint8Array,
  keys: any[]
) => {
  await pgPut(db, update, "leveldb", keys);
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
  db: pg.Pool,
  docName: string,
  sv: any,
  clock: number
) => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, clock);
  encoding.writeVarUint8Array(encoder, sv);
  await pgPutUpsert(
    db,
    createDocumentStateVectorKeyMap(docName, clock),
    encoding.toUint8Array(encoder),
    "ws",
    createDocumentStateVectorKey(docName)
  );
};

const pgGet = async (
  db: pg.Pool,
  key: Map<string, string>
): Promise<Uint8Array> => {
  let res: QueryResult<TeXSync>;
  try {
    let sql = `select value from tex_sync where key = $1`;
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
    const query = `INSERT INTO tex_sync (key, value, plain_value, version, content_type, doc_name, clock, source) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) `;
    const decoder = new TextDecoder("utf-8");
    let text: string = decoder.decode(val);
    let version = keys[0];
    let contentType = keys[2] || "default";
    let docName = keys[1];
    let clock = keys[3] || 0;
    // https://stackoverflow.com/questions/1347646/postgres-error-on-insert-error-invalid-byte-sequence-for-encoding-utf8-0x0
    let replacedText = text
      .replaceAll("", "")
      .replaceAll("0x00", "")
      .replaceAll(/\u0000/g, "");
    const values = [
      JSON.stringify(keys),
      Buffer.from(val),
      replacedText,
      version,
      contentType,
      docName,
      clock,
      source,
    ];
    const res: pg.QueryResult<any> = await db.query(query, values);
  } catch (err: any) {
    logger.error(
      "Insert tex sync record error:" + JSON.stringify(keys) + ",val:" + val,
      err.stack
    );
  }
};

const pgPut = async (
  db: pg.Pool,
  val: Uint8Array,
  source: string,
  keys: any[]
) => {
  try {
    const query = `INSERT INTO tex_sync (key, value, plain_value, version, content_type, doc_name, clock, source) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) `;
    const decoder = new TextDecoder("utf-8");
    let text: string = decoder.decode(val);
    let version = keys[0];
    let contentType = keys[2] || "default";
    let docName = keys[1];
    let clock = keys[3] || 0;
    // https://stackoverflow.com/questions/1347646/postgres-error-on-insert-error-invalid-byte-sequence-for-encoding-utf8-0x0
    let replacedText = text
      .replaceAll("", "")
      .replaceAll("0x00", "")
      .replaceAll(/\u0000/g, "");
    const values = [
      JSON.stringify(keys),
      Buffer.from(val),
      replacedText,
      version,
      contentType,
      docName,
      clock,
      source,
    ];
    const res: pg.QueryResult<any> = await db.query(query, values);
  } catch (err: any) {
    logger.error(
      "Insert tex sync record error:" + JSON.stringify(keys) + ",val:" + val,
      err.stack
    );
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
    const query = `INSERT INTO tex_sync (key, value, plain_value, version, content_type, doc_name, clock, source) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
      ON CONFLICT (key) DO UPDATE 
      SET value = $2, plain_value = $3`;
    const decoder = new TextDecoder("utf-8");
    let content = String.fromCharCode(...new Uint8Array(val));
    // let decodedUpdate = Y.decodeUpdateV2(val);
    logger.info("decoded update:" + content);
    let text: string = decoder.decode(val);
    let version = key.get("version") || "default";
    let contentType = key.get("contentType") || "default";
    let docName = key.get("docName") ? key.get("docName") : "default";
    let clock = key.get("clock") ? key.get("clock") : -1;
    // https://stackoverflow.com/questions/1347646/postgres-error-on-insert-error-invalid-byte-sequence-for-encoding-utf8-0x0
    let replacedText = content
      .replaceAll("", "")
      .replaceAll("0x00", "")
      .replaceAll(/\u0000/g, "");
    const values = [
      JSON.stringify(keys),
      Buffer.from(val),
      replacedText,
      version,
      contentType,
      docName,
      clock,
      source,
    ];
    const res: pg.QueryResult<any> = await db.query(query, values);
  } catch (err: any) {
    logger.error("Insert pgPutUpsert error:" + JSON.stringify(keys), err.stack);
  }
};

const pgPutUpsert = async (
  db: pg.Pool,
  key: Map<string, string>,
  val: Uint8Array,
  source: string,
  keys: any[]
) => {
  try {
    const query = `INSERT INTO tex_sync (key, value, plain_value, version, content_type, doc_name, clock, source) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
      ON CONFLICT (key) DO UPDATE 
      SET value = $2, plain_value = $3`;
    const decoder = new TextDecoder("utf-8");
    let content = String.fromCharCode(...new Uint8Array(val));
    // let decodedUpdate = Y.decodeUpdateV2(val);
    logger.info("decoded update:" + content);
    let text: string = decoder.decode(val);
    let version = key.get("version") || "default";
    let contentType = key.get("contentType") || "default";
    let docName = key.get("docName") ? key.get("docName") : "default";
    let clock = key.get("clock") ? key.get("clock") : -1;
    // https://stackoverflow.com/questions/1347646/postgres-error-on-insert-error-invalid-byte-sequence-for-encoding-utf8-0x0
    let replacedText = content
      .replaceAll("", "")
      .replaceAll("0x00", "")
      .replaceAll(/\u0000/g, "");
    const values = [
      JSON.stringify(keys),
      Buffer.from(val),
      replacedText,
      version,
      contentType,
      docName,
      clock,
      source,
    ];
    const res: pg.QueryResult<any> = await db.query(query, values);
  } catch (err: any) {
    logger.error("Insert pgPutUpsert error:" + JSON.stringify(keys), err.stack);
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
  db: pg.Pool,
  docName: string
): Promise<number> => {
  const result: any[] = await getPgUpdates(db, docName, {
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
    const query = `delete from tex_sync where doc_name = $1 and content_type=$2 and clock >= $3 and clock < $4`;
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
