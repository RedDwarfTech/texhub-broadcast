import { WSSharedDoc } from "@/collar/ws_share_doc.js";
import { Socket } from "socket.io";
// @ts-ignore
import * as encoding from "lib0/encoding";
import { SyncMessageType } from "@/model/texhub/sync_msg_type.js";
import { SyncMessageContext } from "@/model/texhub/sync_msg_context.js";
import { v4 as uuidv4 } from "uuid";
// @ts-ignore
import * as syncProtocol from "y-protocols/sync";
import { send } from "../../action/ws_action.js";
import { SyncFileAttr } from "@/model/texhub/sync_file_attr.js";
import {
  broadcastToDocRoom,
  toDocRoom,
} from "@/common/sync/room_broadcast.js";

export const serverSendSyncStep1 = (
  curSubDoc: WSSharedDoc,
  subdocGuid: string,
  conn: Socket,
  syncFileAttr: SyncFileAttr
) => {
  // send sync step 1
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, SyncMessageType.SubDocMessageSync);

  const uniqueValue = uuidv4();
  let msg: SyncMessageContext = {
    doc_name: subdocGuid,
    src: "sendSyncStep1submsghandler",
    trace_id: uniqueValue,
    msg_type: "sync_step_1",
  };
  let msgStr = JSON.stringify(msg);

  encoding.writeVarString(encoder, msgStr);
  syncProtocol.writeSyncStep1(encoder, curSubDoc);
  send(curSubDoc, conn, encoding.toUint8Array(encoder), syncFileAttr);
  // Register update handler for the subdocument
  // @ts-ignore - Y.Doc has on method but TypeScript doesn't know about it
};

export const writeSyncStep2 = (
  curSubDoc: WSSharedDoc,
  conn: Socket,
  syncFileAttr: SyncFileAttr
) => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, SyncMessageType.SubDocMessageSync);

  const uniqueValue = uuidv4();
  let msg: SyncMessageContext = {
    doc_name: curSubDoc.name,
    src: "sendSyncStep2submsghandler",
    trace_id: uniqueValue,
    msg_type: "sync_step_2",
  };
  let msgStr = JSON.stringify(msg);
  encoding.writeVarString(encoder, msgStr);
  syncProtocol.writeSyncStep2(encoder, curSubDoc);
  send(curSubDoc, conn, encoding.toUint8Array(encoder), syncFileAttr);
};

export const serverWriteUpdate = (
  update: Uint8Array,
  subdocGuid: string,
  _rootDoc: WSSharedDoc,
  origin: Socket
) => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, SyncMessageType.SubDocMessageSync);

  const uniqueValue = uuidv4();
  let msg: SyncMessageContext = {
    doc_name: subdocGuid,
    src: "handleSubDocUpdate",
    trace_id: uniqueValue,
    msg_type: "update",
  };
  let msgStr = JSON.stringify(msg);

  encoding.writeVarString(encoder, msgStr);
  syncProtocol.writeUpdate(encoder, update);

  const message = encoding.toUint8Array(encoder);
  // P1（docs/design/message-reliable.md §6.1）：subdoc 更新改经子文档 room 广播，
  // 排除发起者，保持与原先遍历 rootDoc.conns 时"不回显给 origin"一致的语义，
  // 并借助 Redis Adapter 覆盖所有实例上订阅该子文档的连接。
  broadcastToDocRoom(toDocRoom(subdocGuid), message, origin && origin.id);
};
