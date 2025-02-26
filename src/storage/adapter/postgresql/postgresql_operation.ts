import * as Y from "yjs";
import * as binary from "lib0/binary.js";
import * as encoding from "lib0/encoding.js";
import * as decoding from "lib0/decoding.js";
import pg, { QueryResult } from "pg";
import logger from "../../../common/log4js_config.js";
import {
  createDocumentStateVectorKeyMap,
  createDocumentUpdateKey,
  createSimpleDocumentStateVectorKeyMap,
} from "./postgresql_const.js";
import { TeXSync } from "../../../model/yjs/storage/sync/tex_sync.js";

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
    const sql =
      queryPart + fromPart + filterPart + orderPart + " limit " + opts.limit;
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
  db: any,
  docName: string,
  stateAsUpdate: any,
  stateVector: any
) => {
  const clock = await storeUpdate(db, docName, stateAsUpdate);
  await writeStateVector(db, docName, stateVector, clock);
  await clearUpdatesRange(db, docName, 0, clock); // intentionally not waiting for the promise to resolve!
  return clock;
};

export const storeUpdate = async (
  db: pg.Pool,
  docName: string,
  update: Uint8Array
) => {
  const clock = await getCurrentUpdateClock(db, docName);
  if (clock === -1) {
    // make sure that a state vector is aways written, so we can search for available documents
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, update);
    const sv = Y.encodeStateVector(ydoc);
    await writeStateVector(db, docName, sv, 0);
  }
  await pgPut(db, createDocumentUpdateKey(docName, clock + 1), update, "ws");
  return clock + 1;
};

export const storeUpdateBySrc = async (
  db: pg.Pool,
  docName: string,
  update: Uint8Array,
  clock: number
) => {
  await pgPut(db, createDocumentUpdateKey(docName, clock + 1), update, "leveldb");
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
  await pgPut(
    db,
    createDocumentStateVectorKeyMap(docName, clock),
    encoding.toUint8Array(encoder),
    "ws"
  );
};

const pgGet = async (
  db: pg.Pool,
  key: Map<string, string>
): Promise<Uint8Array<ArrayBufferLike>> => {
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

const pgPut = async (
  db: pg.Pool,
  key: Map<string, string>,
  val: Uint8Array,
  source: string
) => {
  try {
    const query = `INSERT INTO tex_sync (key, value, plain_value, version, content_type, doc_name, clock, source) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
      ON CONFLICT (key) DO UPDATE
      SET value = $2, plain_value=$3`;
    const decoder = new TextDecoder("utf-8");
    let text: string = decoder.decode(val);
    let version = key.get("version") || "default";
    let contentType = key.get("contentType") || "default";
    let docName = key.get("docName") ? key.get("docName") : "default";
    let clock = key.get("clock") ? key.get("clock") : -1;
    let mapValues = key.values();
    const array = Array.from(mapValues);
    // https://stackoverflow.com/questions/1347646/postgres-error-on-insert-error-invalid-byte-sequence-for-encoding-utf8-0x0
    let replacedText = text
      .replaceAll("", "")
      .replaceAll("0x00", "")
      .replaceAll(/\u0000/g, "");
    const values = [
      JSON.stringify(array),
      Buffer.from(val),
      replacedText,
      version,
      contentType,
      docName,
      clock,
      "websocket"
    ];
    const res: pg.QueryResult<any> = await db.query(query, values);
  } catch (err: any) {
    logger.error("Insert error:", err.stack);
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
) =>
  clearRange(
    db,
    createDocumentUpdateKey(docName, from),
    createDocumentUpdateKey(docName, to)
  );

const clearRange = async (db: any, gte: any, lt: any) => {
  /* istanbul ignore else */
  if (db.supports.clear) {
    await db.clear({ gte, lt });
  } else {
    const keys = (
      await getPgBulkData(
        db,
        {
          values: false,
          keys: true,
          gte,
          lt,
        },
        ""
      )
    ).map((item) => item.key);
    const ops = keys.map((key: any) => ({ type: "del", key }));
    await db.batch(ops);
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
