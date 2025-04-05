// @ts-ignore
import { setIfUndefined } from "rdlib0/dist/map.mjs";
import { WSSharedDoc } from "./ws_share_doc.js";
import { persistencePostgresql } from "../storage/storage.js";
// @ts-ignore
import encoding from "rdlib0/dist/encoding.mjs";
import { send } from "../websocket/conn/ws_action.js";
import { callbackRequest, getContent } from "./ydoc_callback.js";
// @ts-ignore
import syncProtocol from "rdy-protocols/dist/sync.mjs";
// @ts-ignore
import * as Y from "rdyjs";
import debounce from 'lodash';

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
 * @return {WSSharedDoc}
 */
export const getYDoc = (docname: string, gc: boolean = true): WSSharedDoc =>
  setIfUndefined(docs, docname, () => {
    const doc: WSSharedDoc = new WSSharedDoc(docname);
    doc.gc = gc;
    if (persistencePostgresql) {
      persistencePostgresql.bindState(docname, doc);
    }
    docs.set(docname, doc);
    return doc;
  });

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

const doCallback = (doc: WSSharedDoc) =>{
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
}


/**
 * @param {Uint8Array} update
 * @param {any} _origin
 * @param {WSSharedDoc} doc
 * @param {any} _tr
 */
export const updateHandler = (update:any, _origin:any, doc:any, _tr:any) => {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, messageSync)
  syncProtocol.writeUpdate(encoder, update)
  const message = encoding.toUint8Array(encoder)
  doc.conns.forEach((_:any, conn:any) => send(doc, conn, message))
}

export const initTpl = (docId: string, projectId: string, initContext: any) => {
  let docOpt = {
    guid: docId,
    collectionid: projectId,
  };
  const ydoc = new Y.Doc(docOpt);
  const ytext = ydoc.getText(docId);
};
