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
  insertKey,
  mergeUpdates,
  readStateVector,
  storeUpdate,
  storeUpdateBySrc,
} from "./postgresql_operation.js";
import { dbConfig } from "./db_config.js";
import { PREFERRED_TRIM_SIZE } from "./postgresql_const.js";
import { TeXSync } from "../../../model/yjs/storage/sync/tex_sync.js";

export class PostgresqlPersistance {
  pool: pg.Pool;

  constructor({ level = defaultLevel, levelOptions = {} } = {}) {
    const pool = new Pool(dbConfig);
    this.pool = pool;
  }

  async getYDoc(docName: string) {
    const updates: Array<TeXSync> = await getPgUpdates(this.pool, docName);
    const ydoc = new Y.Doc();
    ydoc.transact(() => {
      for (let i = 0; i < updates.length; i++) {
        Y.applyUpdate(ydoc, updates[i].value);
      }
    });
    if (updates.length > PREFERRED_TRIM_SIZE) {
      flushDocument(
        this.pool,
        docName,
        Y.encodeStateAsUpdate(ydoc),
        Y.encodeStateVector(ydoc)
      );
    }
    return ydoc;
  }

  flushDocument(docName: string) {
    const updates = getPgUpdates(this.pool, docName);
    const { update, sv } = mergeUpdates(updates);
    flushDocument(this.pool, docName, update, sv);
  }

  async getStateVector(docName: string) {
    const { clock, sv } = await readStateVector(this.pool, docName);
    let curClock = -1;
    if (sv !== null) {
      curClock = await getCurrentUpdateClock(this.pool, docName);
    }
    if (sv !== null && clock === curClock) {
      return sv;
    } else {
      // current state vector is outdated
      const updates = getPgUpdates(this.pool, docName);
      const { update, sv } = mergeUpdates(updates);
      flushDocument(this.pool, docName, update, sv);
      return sv;
    }
  }

  storeUpdate(docName: string, update: Uint8Array) {
    return storeUpdate(this.pool, docName, update);
  }

  async storeUpdateWithSource(
    update: Uint8Array,
    keyMap: Map<string, string>
  ) {
    return await storeUpdateBySrc(this.pool, keyMap, update);
  }

  async insertKeys(
    keyMap: any[]
  ) {
    return await insertKey(this.pool, keyMap);
  }

  async getDiff(docName: any, stateVector: any) {
    const ydoc: any = await this.getYDoc(docName);
    return Y.encodeStateAsUpdate(ydoc, stateVector);
  }
}
