import { Socket } from "socket.io";
import { WSSharedDoc } from "@collar/ws_share_doc.js";
// @ts-ignore
import * as encoding from "rdlib0/dist/encoding.mjs";
// @ts-ignore
import * as decoding from "rdlib0/dist/decoding.mjs";
import logger from "@common/log4js_config.js";
import { getYDoc } from "@collar/yjs_utils.js";
import { SyncMessageType } from "@model/texhub/sync_msg_type.js";
import { send } from "../ws_action.js";
// @ts-ignore
import * as syncProtocol from "rdy-protocols/dist/sync.mjs";

/**
 * relationship of main doc & sub docs
 * @type {Map<String, Map<String, WSSharedDoc>>} mainDocID, subDocID
 */
const subdocsMap: Map<String, Map<String, WSSharedDoc>> = new Map();

/**
 * hand the subdocument message
 * https://discuss.yjs.dev/t/extend-y-websocket-provider-to-support-sub-docs-synchronization-in-one-websocket-connection/1294
 *
 * @param rootDoc
 * @param conn
 * @param message
 */
export const handleSubDocMsg = (
  rootDoc: WSSharedDoc,
  conn: Socket,
  decoder: any
) => {
  let targetDoc = rootDoc;
  preHandleSubDoc(decoder, conn, targetDoc, rootDoc);
};

const preHandleSubDoc = (
  decoder: any,
  conn: Socket,
  targetDoc: WSSharedDoc,
  rootDoc: WSSharedDoc
) => {
  try {
    const encoder = encoding.createEncoder();
    const docGuid = decoding.readVarString(decoder);
    if (docGuid !== rootDoc.name) {
      logger.warn(
        "this is an subdocument,subDocMessageType,doc guid:" + docGuid
      );
      handleSubDoc(targetDoc, docGuid, conn, rootDoc);
    }
    try {
      encoding.writeVarUint(encoder, SyncMessageType.SubDocMessageSync);
      encoding.writeVarString(encoder, targetDoc.name);
      if (decoding.hasContent(decoder)) {
        syncProtocol.readSyncMessage(decoder, encoder, targetDoc, null);
        if (encoding.length(encoder) > 1 && needSend(encoder)) {
          send(targetDoc, conn, encoding.toUint8Array(encoder));
        }
      }
    } catch (e) {
      logger.error("write sub document sync failed, docGuid:" + docGuid, e);
    }
  } catch (err) {
    logger.error("handle sub doc facing issue:" + rootDoc.name, err);
  }
};

const handleSubDoc = (
  targetDoc: WSSharedDoc,
  docGuid: string,
  conn: Socket,
  rootDoc: WSSharedDoc
) => {
  // subdoc
  targetDoc = getYDoc(docGuid, false);
  if (!targetDoc.conns.has(conn)) targetDoc.conns.set(conn, new Set());

  const subm: Map<String, WSSharedDoc> | undefined = subdocsMap.get(
    rootDoc.name
  );
  if (subm && subm.has(targetDoc.name)) {
    // sync step 1 done before.
  } else {
    if (subm) {
      subm.set(targetDoc.name, targetDoc);
    } else {
      const nm = new Map();
      nm.set(targetDoc.name, targetDoc);
      subdocsMap.set(rootDoc.name, nm);
    }
    let td = targetDoc.getText();
    let tds = td.toString();
    let tdd = targetDoc.getText(docGuid);
    let tdds = tdd.toString();
    logger.info("target doc tdds:" , tdds);
    logger.info("target doc:" + tds);

    // send sync step 1
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, SyncMessageType.SubDocMessageSync);
    encoding.writeVarString(encoder, targetDoc.name);
    syncProtocol.writeSyncStep1(encoder, targetDoc);
    send(targetDoc, conn, encoding.toUint8Array(encoder));
  }
};

/**
 * if the document only contains message type and document guid
 * skip and not send this invalid message
 *
 * @param {encoding.Encoder} encoder
 */
const needSend = (encoder: any) => {
  try {
    const buf = encoding.toUint8Array(encoder);
    const decoder = decoding.createDecoder(buf);
    if (!decoding.hasContent(decoder)) {
      logger.warn("the origin did not has content");
      return false;
    }
    decoding.readVarUint(decoder);
    if (!decoding.hasContent(decoder)) {
      logger.warn("the origin read msg type did not has content");
      return false;
    }
    decoding.readVarString(decoder);
    return decoding.hasContent(decoder);
  } catch (e) {
    logger.error("need send checked failed", e);
  }
  return false;
};
