import * as Y from "yjs";
import * as promise from "lib0/promise.js";
import * as binary from "lib0/binary.js";
import * as encoding from "lib0/encoding.js";
import * as decoding from "lib0/decoding.js";

export const getPgUpdates = (
  db: any,
  docName: string,
  opts = { values: true, keys: false, reverse: false, limit: 1 }
) =>
  getPgBulkData(db, {
    gte: createDocumentUpdateKey(docName, 0),
    lt: createDocumentUpdateKey(docName, binary.BITS32),
    ...opts,
  });

export const getPgBulkData = (db: any, opts: any): any =>
  promise.create((resolve, reject) => {
    /**
     * @type {Array<any>} result
     */
    const result: Array<any> = [];

    db.createReadStream(opts)
      .on("data", /** @param {any} data */ (data: any) => result.push(data))
      .on("end", () => resolve(result))
      .on("error", reject);
  });

const createDocumentUpdateKey = (docName: string, clock: any) => [
  "v1",
  docName,
  "update",
  clock,
];

const createDocumentMetaKey = (docName: string, metaKey: string) => [
  "v1",
  docName,
  "meta",
  metaKey,
];

const createDocumentStateVectorKey = (docName: string): string =>
  "v1_sv" + docName;

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

export const storeUpdate = async (db: any, docName: string, update: any) => {
  const clock = await getCurrentUpdateClock(db, docName);
  if (clock === -1) {
    // make sure that a state vector is aways written, so we can search for available documents
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, update);
    const sv = Y.encodeStateVector(ydoc);
    await writeStateVector(db, docName, sv, 0);
  }
  await levelPut(db, createDocumentUpdateKey(docName, clock + 1), update);
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
  await levelPut(
    db,
    createDocumentStateVectorKey(docName),
    encoding.toUint8Array(encoder)
  );
};

const levelGet = async (db: any, key: string) => {
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

const levelPut = async (db: any, key: any, val: any) =>
  db.put(key, Buffer.from(val));

export const getCurrentUpdateClock = (db: any, docName: string) =>
  getPgUpdates(db, docName, {
    keys: true,
    values: false,
    reverse: true,
    limit: 1,
  }).then((keys: any) => {
    if (keys.length === 0) {
      return -1;
    } else {
      return keys[0][3];
    }
  });

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
  return decodeLeveldbStateVector(buf);
};

const decodeLeveldbStateVector = (buf: any) => {
  const decoder = decoding.createDecoder(buf);
  const clock = decoding.readVarUint(decoder);
  const sv = decoding.readVarUint8Array(decoder);
  return { sv, clock };
};
