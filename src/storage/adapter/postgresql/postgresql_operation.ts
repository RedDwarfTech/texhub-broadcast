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
} from "./conf/postgresql_const.js";
import { TeXSync } from "@model/yjs/storage/sync/tex_sync.js";
import { v4 as uuidv4 } from "uuid";
import { getPgPool, getRedisClient } from "./conf/database_init.js";
import { PostgresqlPersistance } from "./postgresql_persistance.js";
import { persistencePostgresql } from "@/storage/storage.js";
import { SyncFileAttr } from "@/model/texhub/sync_file_attr.js";
import { UpdateOrigin } from "@/model/yjs/net/update_origin.js";
import { getRedisDestriLock, unlock } from "@/common/cache/redis_util.js";
import { ENABLE_DEBUG } from "@/common/log_util.js";

export const getDocAllUpdates = async (
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
      let uo: UpdateOrigin = {
        name: "mergeUpdates",
        origin: "server",
      };
      Y.applyUpdate(ydoc, updates[i], uo);
    }
  });
  return { update: Y.encodeStateAsUpdate(ydoc), sv: Y.encodeStateVector(ydoc) };
};

export const flushDocument = async (
  db: pg.Pool,
  syncFileAttr: SyncFileAttr,
  stateAsUpdate: any,
  stateVector: any
) => {
  const clock = await storeUpdate(syncFileAttr, stateAsUpdate);
  await writeStateVector(syncFileAttr.docName, stateVector, clock);
  await clearUpdatesRange(db, syncFileAttr.docName, 0, clock); // intentionally not waiting for the promise to resolve!
  return clock;
};

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
    let uo: UpdateOrigin = {
      name: "storeUpdateTrans",
      origin: "server",
    };
    Y.applyUpdate(ydoc, update, uo);
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

export const storeUpdate = async (
  syncFileAttr: SyncFileAttr,
  update: Uint8Array
) => {
  const uniqueValue = uuidv4();
  const lockKey = `lock:${syncFileAttr.docName}:update`;
  try {
    if (await getRedisDestriLock(lockKey, uniqueValue, 0)) {
      const processYdoc = new Y.Doc({
        guid: syncFileAttr.docName,
      });
      if (ENABLE_DEBUG) {
        let uo: UpdateOrigin = {
          name: "storeUpdate-processYdoc",
          origin: "server",
        };
        Y.applyUpdate(processYdoc, update, uo);
        const text = processYdoc.getText(syncFileAttr.docName).toString();
        logger.info("process by distribute lock:" + text);
        logger.info("processYdoc update", 2, {
          json: processYdoc.toJSON(),
          missing: processYdoc.store.pendingStructs?.missing,
        });
        logger.info("所有text名称:", Array.from(processYdoc.share.keys()));
      }
      const clock = await getCurrentUpdateClock(syncFileAttr.docName);
      if (clock === -1) {
        const ydoc = new Y.Doc();
        let uo1: UpdateOrigin = {
          name: "storeUpdate-ydoc",
          origin: "server",
        };
        Y.applyUpdate(ydoc, update, uo1);
        const sv = Y.encodeStateVector(ydoc);
        await writeStateVector(syncFileAttr.docName, sv, 0);
      }
      await pgPut(
        update,
        "ws",
        createDocumentUpdateKeyArray(syncFileAttr.docName, clock + 1),
        false
      );
      const postgresqlDb: PostgresqlPersistance =
        persistencePostgresql.provider;
      const persistedYdoc: any = await postgresqlDb.getYDoc(syncFileAttr);
      let dbSubdocText = persistedYdoc.getText(syncFileAttr.docName);
      let dbSubdocTextStr = dbSubdocText.toString();
      if (dbSubdocTextStr === "") {
        logger.warn(
          "doc turn to null,doc id:" +
            JSON.stringify(syncFileAttr) +
            ",clock:" +
            clock
        );
      }
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

export const storeUpdateBySrc = async (update: Uint8Array, keys: any[]) => {
  await pgPut(update, "leveldb", keys);
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

const writeStateVector = async (docName: string, sv: any, clock: number) => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, clock);
  encoding.writeVarUint8Array(encoder, sv);
  await pgPutUpsert(
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
    const query = `INSERT INTO tex_sync (key, value, version, content_type, doc_name, clock, source) 
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

const pgPut = async (
  val: Uint8Array,
  source: string,
  keys: any[],
  isHistory: boolean = false
) => {
  try {
    // we think there is no need to use on conflict do update
    // it is impossible to conflict with the key
    let tableName = isHistory ? "tex_sync_history" : "tex_sync";
    const query =
      `INSERT INTO ` +
      tableName +
      ` (key, value, version, content_type, doc_name, clock, source) 
      VALUES ($1, $2, $3, $4, $5, $6, $7) `;
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
    ];
    let sysDb = await getPgPool();
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
    const query = `INSERT INTO tex_sync (key, value, version, content_type, doc_name, clock, source) 
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (key) DO UPDATE
      SET value = $2, version = $3, content_type = $4, doc_name = $5, clock = $6, source = $7`;
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
  keys: any[]
) => {
  try {
    const query = `INSERT INTO tex_sync (key, value, version, content_type, doc_name, clock, source) 
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (key) DO UPDATE
      SET value = $2, version = $3, content_type = $4, doc_name = $5, clock = $6, source = $7`;
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
    ];
    let sysDb = getPgPool();
    const res: pg.QueryResult<any> = await sysDb!.query(query, values);
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
