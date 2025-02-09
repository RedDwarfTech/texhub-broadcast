// @ts-ignore
import { setIfUndefined } from "lib0/dist/map.cjs";
import { WSSharedDoc } from "./ws_share_doc.js";
import { persistence } from "../storage/leveldb.js";
// @ts-ignore
import encoding from "lib0/dist/encoding.cjs";
// @ts-ignore
import decoding from "lib0/dist/decoding.cjs";
import { send } from "../websocket/conn/ws_action.js";
import { callbackRequest, getContent } from "./ydoc_callback.js";
// @ts-ignore
import syncProtocol from "y-protocols/dist/sync.cjs";
// @ts-ignore
import yjspkg from "yjs";
const { Y } = yjspkg;
// @ts-ignore
import pkg from "y-websocket";
const { WebsocketProvider } = pkg;

const CALLBACK_URL = process.env.CALLBACK_URL
  ? new URL(process.env.CALLBACK_URL)
  : null;
const CALLBACK_TIMEOUT = process.env.CALLBACK_TIMEOUT || 5000;
const CALLBACK_OBJECTS = process.env.CALLBACK_OBJECTS
  ? JSON.parse(process.env.CALLBACK_OBJECTS)
  : {};

export const docs = new Map<string, WSSharedDoc>();
export const messageSync = 0;

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
    if (persistence !== null) {
      persistence.bindState(docname, doc);
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
  doc: WSSharedDoc
) => {
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
 * @param {any} origin
 * @param {WSSharedDoc} doc
 */
export const updateHandler = (
  update: Uint8Array<ArrayBufferLike>,
  origin: any,
  doc: WSSharedDoc
) => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeUpdate(encoder, update);
  const message = encoding.toUint8Array(encoder);
  doc.conns.forEach((_, conn) => {
    send(doc, conn, message);
  });
};

export const initTpl = (docId: string, projectId: string, initContext: any) => {
  let docOpt = {
    guid: docId,
    collectionid: projectId,
  };
  const ydoc = new Y.Doc(docOpt);
  const ytext = ydoc.getText(docId);
  // https://github.com/node-fetch/node-fetch/issues/1624
  const wsProvider = new WebsocketProvider("ws://127.0.0.1:1234", docId, ydoc, {
    WebSocketPolyfill: require("ws"),
  });
  wsProvider.on("status", (event: any) => {
    if (event.status === "connected") {
      console.log("connected");
      if (wsProvider.ws) {
        console.log("ws");
        if (initContext && initContext.length > 0) {
          console.log("insert:");
          ytext.insert(0, initContext);
        }
      }
    }
  });
};
