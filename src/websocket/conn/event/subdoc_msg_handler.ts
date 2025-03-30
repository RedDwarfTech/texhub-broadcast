import { Socket } from "socket.io";
import { WSSharedDoc } from "@collar/ws_share_doc.js";
// @ts-ignore
import encoding from "lib0/dist/encoding.cjs";
// @ts-ignore
import decoding from "lib0/dist/decoding.cjs";
import logger from "@common/log4js_config.js";
import { getYDoc } from "@collar/yjs_utils.js";

/**
 * relationship of main doc & sub docs
 * @type {Map<String, Map<String, WSSharedDoc>>} mainDocID, subDocID
 */
const subdocsMap: Map<String, Map<String, WSSharedDoc>> = new Map();

/**
 * hand the subdocument message
 * https://discuss.yjs.dev/t/extend-y-websocket-provider-to-support-sub-docs-synchronization-in-one-websocket-connection/1294
 * 
 * @param doc 
 * @param conn 
 * @param message 
 */
export const handleSubDocMsg = (
  doc: WSSharedDoc,
  conn: Socket,
  message: Uint8Array
) => {
  let targetDoc = doc;
  preHandleSubDoc(message, conn, targetDoc, doc);
};

const preHandleSubDoc = (
  message: Uint8Array,
  conn: Socket,
  targetDoc: WSSharedDoc,
  doc: WSSharedDoc
) => {
  try {
    const subDocDecoder = decoding.createDecoder(message);
    const subDocMessageType: number = decoding.readVarUint(subDocDecoder);
    const docGuid = decoding.readVarString(subDocDecoder);
    if (docGuid !== doc.name) {
      logger.warn(
        "this is an subdocument,subDocMessageType:" +
          subDocMessageType +
          ",doc guid:" +
          docGuid
      );
      handleSubDoc(targetDoc, docGuid, conn, doc);
    }
  } catch (err) {
    logger.error(
      "handle sub doc facing issue" +
        ", msg: " +
        Buffer.from(message).toString("base64"),
      err
    );
  }
};

const handleSubDoc = (
  targetDoc: WSSharedDoc,
  docGuid: string,
  conn: Socket,
  doc: WSSharedDoc
) => {
  // subdoc
  targetDoc = getYDoc(docGuid, false);
  if (!targetDoc.conns.has(conn)) targetDoc.conns.set(conn, new Set());

  /**@type {Map<String, Boolean>}*/ const subm = subdocsMap.get(doc.name);
  if (subm && subm.has(targetDoc.name)) {
    // sync step 1 done before.
  } else {
    if (subm) {
      subm.set(targetDoc.name, targetDoc);
    } else {
      const nm = new Map();
      nm.set(targetDoc.name, targetDoc);
      subdocsMap.set(doc.name, nm);
    }

    // send sync step 1
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    encoding.writeVarString(encoder, targetDoc.name);
    syncProtocol.writeSyncStep1(encoder, targetDoc);
    send(targetDoc, conn, encoding.toUint8Array(encoder));
  }
};

/**
 *
 * @param {encoding.Encoder} encoder
 */
const needSend = (encoder: any) => {
  const buf = encoding.toUint8Array(encoder);
  const decoder = decoding.createDecoder(buf);
  decoding.readVarUint(decoder);
  decoding.readVarString(decoder);
  return decoding.hasContent(decoder);
};
