import { WSSharedDoc } from "@/collar/ws_share_doc.js";
import { Socket } from "socket.io";
// @ts-ignore
import * as encoding from "rdlib0/dist/encoding.mjs";
import { SyncMessageType } from "@/model/texhub/sync_msg_type.js";
import { SyncMessageContext } from "@/model/texhub/sync_msg_context.js";
import { v4 as uuidv4 } from "uuid";
// @ts-ignore
import * as syncProtocol from "rdy-protocols/dist/sync.mjs";
import { send } from "../../action/ws_action.js";

export const serverSendSyncStep1 = (
  curSubDoc: WSSharedDoc,
  subdocGuid: string,
  conn: Socket
) => {
  // send sync step 1
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, SyncMessageType.SubDocMessageSync);

  const uniqueValue = uuidv4();
  let msg: SyncMessageContext = {
    doc_name: subdocGuid,
    src: "sendSyncStep1submsghandler",
    trace_id: uniqueValue,
  };
  let msgStr = JSON.stringify(msg);

  encoding.writeVarString(encoder, msgStr);
  syncProtocol.writeSyncStep1(encoder, curSubDoc);
  send(curSubDoc, conn, encoding.toUint8Array(encoder));
  // Register update handler for the subdocument
  // @ts-ignore - Y.Doc has on method but TypeScript doesn't know about it
};

export const serverWriteUpdate = (
  update: Uint8Array,
  subdocGuid: string,
) => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, SyncMessageType.SubDocMessageSync);

  const uniqueValue = uuidv4();
  let msg: SyncMessageContext = {
    doc_name: subdocGuid,
    src: "handleSubDocUpdate",
    trace_id: uniqueValue,
  };
  let msgStr = JSON.stringify(msg);

  encoding.writeVarString(encoder, msgStr);
  syncProtocol.writeUpdate(encoder, update);
};
