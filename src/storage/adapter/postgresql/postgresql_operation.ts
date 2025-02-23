import * as Y from "yjs";
import * as promise from "lib0/promise.js";
import * as binary from "lib0/binary.js";
import * as encoding from "lib0/encoding.js";
import * as decoding from "lib0/decoding.js";
import pg from "pg";
import logger from "../../../common/log4js_config.js";
import {
  createDocumentStateVectorKeyMap,
  createDocumentUpdateKey,
} from "./postgresql_const.js";
import { TeXSync } from "../../../model/yjs/storage/sync/tex_sync.js";

export const getPgUpdates = (
  db: pg.Pool,
  docName: string,
  opts = { values: true, keys: false, reverse: false, limit: 1 }
): any[] => {
  return getPgBulkData(
    db,
    {
      gte: createDocumentUpdateKey(docName, 0),
      lt: createDocumentUpdateKey(docName, binary.BITS32),
      ...opts,
    },
    docName
  );
};

export const getPgBulkData = (
  db: pg.Pool,
  opts: any,
  docName: string
): TeXSync[] => {
  try {
    let col = [];
    col.push("id");
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
      " where doc_name = " +
      docName +
      " and doc_type=" +
      opts.gte.get("contentType") +
      " and clock>0 and clock <" +
      binary.BITS32;
    let orderPart = " order by clock asc";
    if (opts.reverse) {
      orderPart = " order by clock desc";
    }
    const sql =
      queryPart + fromPart + filterPart + orderPart + " limit " + opts.limit;
    db.query(sql).then((data) => {
      let colValues = data.rows;
      return colValues;
    });
    return [];
  } catch (err) {
    console.error("Query error:", err);
    throw err;
  }
};

const createDocumentMetaKey = (docName: string, metaKey: string) => [
  "v1",
  docName,
  "meta",
  metaKey,
];

const createDocumentStateVectorKey = (docName: string) => ["v1_sv", docName];

const createDocumentMetaEndKey = (docName: string) => ["v1", docName, "metb"];

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
  db: any,
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
  await pgPut(db, createDocumentUpdateKey(docName, clock + 1), update);
  return clock + 1;
};

const writeStateVector = async (
  db: any,
  docName: string,
  sv: any,
  clock: any
) => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, clock);
  encoding.writeVarUint8Array(encoder, sv);
  await pgPut(
    db,
    createDocumentStateVectorKeyMap(docName),
    encoding.toUint8Array(encoder)
  );
};

const levelGet = async (db: any, key: Array<string | number>) => {
  let res;
  try {
    res = await db.get(key);
  } catch (err) {
    /* istanbul ignore else */
    if (err) {
      return null;
    } else {
      throw err;
    }
  }
  return res;
};

const pgPut = async (
  db: pg.Pool,
  key: Map<string, string>,
  val: Uint8Array
) => {
  try {
    const query =
      "INSERT INTO tex_sync (key, value, plain_value, version, content_type, doc_name, clock) VALUES ($1, $2, $3, $4, $5, $6, $7)";
    const decoder = new TextDecoder("utf-8");
    let text = decoder.decode(val);
    if (text && text.trim().length > 0) {
      text.replace("\x00", "null");
    } else {
      text = "unknown";
    }
    let version = key.get("version") || "default";
    let contentType = key.get("contentType") || "default";
    let docName = key.get("docName") ? key.get("docName") : "default";
    let clock = key.get("clock") ? key.get("clock") : -1;
    const values = [
      JSON.stringify(key),
      Buffer.from(val),
      "text",
      version,
      contentType,
      docName,
      clock,
    ];
    logger.log("Insert values:", values);
    const res: pg.QueryResult<any> = await db.query(query, values);
  } catch (err: any) {
    logger.error("Insert error:", err.stack);
  }
};

export const getCurrentUpdateClock = async (
  db: any,
  docName: string
): Promise<number> => {
  const result: any[] = getPgUpdates(db, docName, {
    keys: true,
    values: false,
    reverse: true,
    limit: 1,
  });
  if (result && result.length > 0) {
    return result[0].clock;
  } else {
    return -1;
  }
};

const clearUpdatesRange = async (
  db: any,
  docName: string,
  from: any,
  to: any
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
    const keys = await getPgBulkData(
      db,
      {
        values: false,
        keys: true,
        gte,
        lt,
      },
      ""
    ).map((item) => item.key);
    const ops = keys.map((key: any) => ({ type: "del", key }));
    await db.batch(ops);
  }
};

export const readStateVector = async (db: any, docName: string) => {
  const buf = await levelGet(db, createDocumentStateVectorKey(docName));
  if (buf === null) {
    // no state vector created yet or no document exists
    return { sv: null, clock: -1 };
  }
  return decodePgStateVector(buf);
};

const decodePgStateVector = (buf: any) => {
  const decoder = decoding.createDecoder(buf);
  const clock = decoding.readVarUint(decoder);
  const sv = decoding.readVarUint8Array(decoder);
  return { sv, clock };
};
