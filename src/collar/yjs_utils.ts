// @ts-ignore
import { setIfUndefined } from "rdlib0/dist/map.mjs";
import { WSSharedDoc } from "./ws_share_doc.js";
import { persistencePostgresql } from "../storage/storage.js";
// @ts-ignore
import * as encoding from "rdlib0/dist/encoding.mjs";
import { send } from "../websocket/conn/ws_action.js";
import { callbackRequest, getContent } from "./ydoc_callback.js";
// @ts-ignore
import * as syncProtocol from "rdy-protocols/dist/sync.mjs";
// @ts-ignore
import * as Y from "rdyjs";
import debounce from "lodash";
import { PostgresqlPersistance } from "@/storage/adapter/postgresql/postgresql_persistance.js";
import { SyncFileAttr } from "@/model/texhub/sync_file_attr.js";
import logger from "@/common/log4js_config.js";

const CALLBACK_URL = process.env.CALLBACK_URL
  ? new URL(process.env.CALLBACK_URL)
  : null;
const CALLBACK_TIMEOUT = process.env.CALLBACK_TIMEOUT || 5000;
const CALLBACK_OBJECTS = process.env.CALLBACK_OBJECTS
  ? JSON.parse(process.env.CALLBACK_OBJECTS)
  : {};

export const docs = new Map<string, WSSharedDoc>();
export const messageSync: number = 0;

/**
 * Gets a Y.Doc by name, whether in memory or on disk
 *
 * @param {string} docname - the name of the Y.Doc to find or create
 * @param {boolean} gc - whether to allow gc on the doc (applies only when created)
 * @return {Promise<WSSharedDoc>}
 */
export const getYDoc = (
  syncFileAttr: SyncFileAttr,
  gc: boolean = true
): WSSharedDoc => {
  // 确保docName是字符串类型
  const docName = String(syncFileAttr.docName);
  
  // 调试日志
  logger.debug(`Getting YDoc for docName: ${docName}`);
  logger.debug(`Current docs keys: ${Array.from(docs.keys())}`);
  
  let cachedDocs = docs.get(docName);
  if (cachedDocs) {
    logger.debug(`Found cached doc for: ${docName}`);
    return cachedDocs;
  }
  
  logger.debug(`Creating new doc for: ${docName}`);
  const doc: WSSharedDoc = new WSSharedDoc(docName);
  doc.gc = gc;
  if (persistencePostgresql) {
    persistencePostgresql.bindState(syncFileAttr, doc);
  }
  docs.set(docName, doc);
  return doc;
};

/**
 * @param {Uint8Array} update
 * @param {any} origin
 * @param {WSSharedDoc} doc
 */
export const callbackHandler = (
  update: Uint8Array,
  origin: any,
  doc: any,
  t: Y.Transaction
) => {
  debounce(() => {
    doCallback(doc);
  });
};

const doCallback = (doc: WSSharedDoc) => {
  const room = doc.name;
  const dataToSend = {
    room,
    data: {},
  };
  const sharedObjectList: string[] = Object.keys(CALLBACK_OBJECTS);
  sharedObjectList.forEach((sharedObjectName: string) => {
    const sharedObjectType = CALLBACK_OBJECTS[sharedObjectName];
    dataToSend.data = {
      type: sharedObjectType,
      content: getContent(sharedObjectName, sharedObjectType, doc),
    };
  });
  callbackRequest(CALLBACK_URL!, Number(CALLBACK_TIMEOUT), dataToSend);
};

/**
 * @param {Uint8Array} update
 * @param {any} _origin
 * @param {WSSharedDoc} doc
 * @param {any} _tr
 */
export const updateHandler = (
  update: any,
  _origin: any,
  doc: any,
  _tr: any
) => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeUpdate(encoder, update);
  const message = encoding.toUint8Array(encoder);
  doc.conns.forEach((_: any, conn: any) => send(doc, conn, message));
};

export const initTpl = async (
  docId: string,
  projectId: string,
  initContext: any
) => {
  let docOpt = {
    guid: docId,
    collectionid: projectId,
  };
  const postgresqlDb: PostgresqlPersistance = new PostgresqlPersistance();
  const ydoc = new Y.Doc(docOpt);
  const ytext = ydoc.getText(docId);
  ytext.insert(0, initContext);
  const newUpdates: Uint8Array = Y.encodeStateAsUpdate(ydoc);
  await postgresqlDb.storeUpdate(docId, newUpdates);
};
