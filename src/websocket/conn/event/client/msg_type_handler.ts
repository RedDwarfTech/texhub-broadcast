import { SyncMessageType } from "@model/texhub/sync_msg_type.js";
import { SocketIOClientProvider } from "../../socket_io_client_provider.js";
// @ts-ignore
import * as decoding from "rdlib0/decoding.js";
// @ts-ignore
import * as encoding from "rdlib0/encoding";
// @ts-ignore
import * as syncProtocol from "rdy-protocols/sync";
// @ts-ignore
import * as authProtocol from "rdy-protocols/auth";
import {
  writeVarUint,
  writeVarUint8Array,
  // @ts-ignore
} from "rdlib0/dist/encoding.mjs";
import {
  readVarUint8Array,
  // @ts-ignore
} from "rdlib0/dist/decoding.mjs";
// @ts-ignore
import * as awarenessProtocol from "rdy-protocols/awareness";
import { MessageHandler } from "@/model/yjs/net/msg_handler_fun.js";
import { enableTracing, logYjsUnwrapMsg } from "@/common/tracing/app_trace.js";
import { v4 as uuidv4 } from "uuid";
import { SyncMessageContext } from "@/model/texhub/sync_msg_context.js";
import { RdJsonUtil } from "rdjs-wheel";

export const messageHandlers: MessageHandler[] = [];

/**
 * @param {WebsocketProvider} provider
 * @param {string} reason
 */
const permissionDeniedHandler = (provider: any, reason: any) =>
  console.warn(`Permission denied to access ${provider.url}.\n${reason}`);

messageHandlers[SyncMessageType.SubDocMessageSync] = (
  encoder: any,
  decoder: any,
  provider: SocketIOClientProvider,
  emitSynced: boolean = true,
  messageType: number
) => {
  const context = decoding.readVarString(decoder);
  const isJson = RdJsonUtil.hasJsonStructure(context);
  const docContext = isJson ? JSON.parse(context) : context;
  const docGuid = isJson ? docContext.doc_name : docContext;
  const doc = provider.getDoc(docGuid);
  if (!doc) {
    console.error("doc not found with id: ", docGuid);
    return;
  }

  encoding.writeVarUint(encoder, SyncMessageType.SubDocMessageSync);
  const uniqueValue = uuidv4();
  let msg: SyncMessageContext = {
    doc_name: docGuid,
    src: "messageHandlers",
    trace_id: uniqueValue,
    emitSynced: emitSynced,
    msg_type: "read_sync",
  };
  let msgStr = JSON.stringify(msg);
  // convert to the legacy message without doc guid
  encoding.writeVarString(encoder, msgStr);
  const hasContent = decoding.hasContent(decoder);
  if (!hasContent) {
    console.error("sub doc message sync has no content");
  }
  console.warn("sub doc message sync with content，docGuid:", docGuid);
  let copiedDecoder = decoding.clone(decoder);
  if (!enableTracing()) {
    logYjsUnwrapMsg(copiedDecoder);
  }
  const syncMessageType = syncProtocol.readSyncMessage(
    decoder,
    encoder,
    doc,
    provider
  );

  // main doc synced
  if (
    emitSynced &&
    docGuid === provider.roomname &&
    syncMessageType === syncProtocol.messageYjsSyncStep2 &&
    !provider._synced
  ) {
    provider.synced = true;
    provider.updateSyncedStatus(docGuid, true);
    console.info("main doc synced, docGuid:" + docGuid);
  }
  // sub doc synced
  if (
    emitSynced &&
    docGuid !== provider.roomname &&
    syncMessageType === syncProtocol.messageYjsSyncStep2 &&
    !provider.syncedStatus.get(docGuid)
  ) {
    console.info("sub doc synced, docGuid:" + docGuid);
    provider.updateSyncedStatus(docGuid, true);
  }
};

messageHandlers[SyncMessageType.MessageSync] = (
  encoder: any,
  decoder: any,
  provider: SocketIOClientProvider,
  emitSynced: any,
  messageType: any
) => {
  writeVarUint(encoder, SyncMessageType.MessageSync);
  const syncMessageType = syncProtocol.readSyncMessage(
    decoder,
    encoder,
    provider.doc,
    provider
  );
  if (
    emitSynced &&
    syncMessageType === syncProtocol.messageYjsSyncStep2 &&
    !provider._synced
  ) {
    provider._synced = true;
  }
};

messageHandlers[SyncMessageType.MessageQueryAwareness] = (
  encoder: any,
  _decoder: any,
  provider: any,
  _emitSynced: any,
  _messageType: any
) => {
  writeVarUint(encoder, SyncMessageType.MessageAwareness);
  writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(
      provider.awareness,
      Array.from(provider.awareness.getStates().keys())
    )
  );
};

messageHandlers[SyncMessageType.MessageAwareness] = (
  _encoder: any,
  decoder: any,
  provider: any,
  _emitSynced: any,
  _messageType: any
) => {
  awarenessProtocol.applyAwarenessUpdate(
    provider.awareness,
    readVarUint8Array(decoder),
    provider
  );
};

messageHandlers[SyncMessageType.MessageAuth] = (
  _encoder: any,
  decoder: any,
  provider: any,
  _emitSynced: any,
  _messageType: any
) => {
  authProtocol.readAuthMessage(
    decoder,
    provider.doc,
    (_ydoc: any, reason: any) => permissionDeniedHandler(provider, reason)
  );
};
