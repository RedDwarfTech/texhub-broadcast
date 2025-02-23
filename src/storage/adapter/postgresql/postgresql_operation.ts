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

export const getPgUpdates = (
  db: pg.Pool,
  docName: string,
  opts = { values: true, keys: false, reverse: false, limit: 1 }
): Array<Buffer> => {
  return getPgBulkData(db, {
    gte: createDocumentUpdateKey(docName, 0),
    lt: createDocumentUpdateKey(docName, binary.BITS32),
    ...opts,
  });
};

export const getPgBulkData = (db: pg.Pool, opts: any): Array<Buffer> => {
  try {
    const sql = "select * from tex_sync";
    const res = db.query(sql);
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
      text.replace("0x00", "null");
    } else {
      text = "unknown";
    }
    let version = key.get("version") ? "default" : key.get("version");
    let contentType = key.get("contentType")
      ? "default"
      : key.get("contentType");
    let docName = key.get("docName") ? "default" : key.get("docName");
    let clock = key.get("clock") ? -1 : key.get("docName");
    const values = [
      JSON.stringify(key),
      Buffer.from(val),
      text,
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

export const getCurrentUpdateClock = async (db: any, docName: string) => {
  const result = getPgUpdates(db, docName, {
    keys: true,
    values: false,
    reverse: true,
    limit: 1,
  });
  return 1;
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
    const keys: any = await getPgBulkData(db, {
      values: false,
      keys: true,
      gte,
      lt,
    });
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
