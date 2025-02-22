import * as promise from "lib0/promise.js";
// @ts-ignore
import defaultLevel from "level";
import { Pool } from "pg";
import {
  flushDocument,
  getLevelUpdates,
  mergeUpdates,
} from "./postgresql_operation";
import { keyEncoding, valueEncoding } from "./postgresql_const";
import { dbConfig } from "./db_config";

export class PostgresqlPersistance {
  tr: Promise<unknown>;
  private transact: (f: any) => Promise<unknown>;
  pool: Pool;

  constructor(
    location: string,
    { level = defaultLevel, levelOptions = {} } = {}
  ) {
    const pool = new Pool(dbConfig);
    this.pool = pool;
    const db = level(location, { ...levelOptions, valueEncoding, keyEncoding });
    this.tr = promise.resolve();

    this.transact = (f) => {
      const currTr = this.tr;
      this.tr = (async () => {
        await currTr;
        let res = /** @type {any} */ null;
        try {
          res = await f(db);
        } catch (err) {
          /* istanbul ignore next */
          console.warn("Error during y-leveldb transaction", err);
        }
        return res;
      })();
      return this.tr;
    };

    const flushDocument1 = (docName: string) => {
      return this.transact(async (db: any) => {
        const updates = await getLevelUpdates(db, docName);
        const { update, sv } = mergeUpdates(updates);
        await flushDocument(db, docName, update, sv);
      });
    };
  }
}
