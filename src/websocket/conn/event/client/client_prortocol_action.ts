import { SyncMessageType } from "@/model/texhub/sync_msg_type.js";
// @ts-ignore
import * as encoding from "rdlib0/encoding";
// @ts-ignore
import * as syncProtocol from "rdy-protocols/sync";
import { Socket } from "socket.io-client";
import { v4 as uuidv4 } from "uuid";
import { SyncMessageContext } from "@/model/texhub/sync_msg_context.js";
// @ts-ignore
import * as Y from "rdyjs";

export const clientSendSyncStep1 = (
  docName: string,
  socketio: Socket,
  doc: Y.Doc
) => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, SyncMessageType.SubDocMessageSync);
  const uniqueValue = uuidv4();
  let msg: SyncMessageContext = {
    doc_name: docName,
    src: "providerdocs",
    trace_id: uniqueValue,
  };
  let msgStr = JSON.stringify(msg);
  encoding.writeVarString(encoder, msgStr);
  syncProtocol.writeSyncStep1(encoder, doc);
  socketio.send(encoding.toUint8Array(encoder));
};
