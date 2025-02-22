import * as promise from "lib0/promise.js";
// @ts-ignore
import defaultLevel from "level";
import pg from "pg";
const { Pool } = pg;
// @ts-ignore
import * as Y from "yjs";
import {
  flushDocument,
  getCurrentUpdateClock,
  getPgUpdates,
  mergeUpdates,
  readStateVector,
  storeUpdate,
} from "./postgresql_operation.js";
import { dbConfig } from "./db_config.js";
import { PREFERRED_TRIM_SIZE } from "./postgresql_const.js";

export class PostgresqlPersistance {
  tr: Promise<unknown>;
  transact: (f: any) => Promise<unknown>;
  pool: pg.Pool;

  constructor({ level = defaultLevel, levelOptions = {} } = {}) {
    const pool = new Pool(dbConfig);
    this.pool = pool;
    this.tr = promise.resolve();

    this.transact = (f) => {
      const currTr = this.tr;
      this.tr = (async () => {
        await currTr;
        let res = /** @type {any} */ null;
        try {
          res = await f(pool);
        } catch (err) {
          /* istanbul ignore next */
          console.warn("Error during y-leveldb transaction", err);
        }
        return res;
      })();
      return this.tr;
    };
  }

  getYDoc(docName: string) {
    return this.transact(async (db: any) => {
      const updates = await getPgUpdates(db, docName);
      const ydoc = new Y.Doc();
      ydoc.transact(() => {
        for (let i = 0; i < updates.length; i++) {
          Y.applyUpdate(ydoc, updates[i]);
        }
      });
      if (updates.length > PREFERRED_TRIM_SIZE) {
        await flushDocument(
          db,
          docName,
          Y.encodeStateAsUpdate(ydoc),
          Y.encodeStateVector(ydoc)
        );
      }
      return ydoc;
    });
  }

  flushDocument(docName: string) {
    return this.transact(async (db: any) => {
      const updates = await getPgUpdates(db, docName);
      const { update, sv } = mergeUpdates(updates);
      await flushDocument(db, docName, update, sv);
    });
  }

  getStateVector(docName: any) {
    return this.transact(async (db: any) => {
      const { clock, sv } = await readStateVector(db, docName);
      let curClock = -1;
      if (sv !== null) {
        curClock = await getCurrentUpdateClock(db, docName);
      }
      if (sv !== null && clock === curClock) {
        return sv;
      } else {
        // current state vector is outdated
        const updates = await getPgUpdates(db, docName);
        const { update, sv } = mergeUpdates(updates);
        await flushDocument(db, docName, update, sv);
        return sv;
      }
    });
  }

  storeUpdate(docName: string, update: any) {
    return this.transact((db:any) => storeUpdate(db, docName, update));
  }

  async getDiff(docName: any, stateVector: any) {
    const ydoc: any = await this.getYDoc(docName);
    return Y.encodeStateAsUpdate(ydoc, stateVector);
  }
}
