import { SyncMessageType } from "@model/texhub/sync_msg_type.js";
import { SocketIOClientProvider } from "../../socket_io_client_provider.js";
// @ts-ignore
import * as decoding from "lib0/decoding.js";
// @ts-ignore
import * as encoding from "lib0/encoding";
// @ts-ignore
import * as syncProtocol from "y-protocols/sync";
// @ts-ignore
import * as authProtocol from "y-protocols/auth";
import {
  writeVarUint,
  writeVarUint8Array,
  // @ts-ignore
} from "lib0/encoding";
import {
  readVarUint8Array,
  // @ts-ignore
} from "lib0/decoding";
// @ts-ignore
import * as awarenessProtocol from "y-protocols/awareness";
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
  if (!decoding.hasContent(decoder)) {
    // A SubDocMessageSync frame must carry a context string. Frames that only
    // contain the message type are malformed, so drop them instead of letting
    // readVarString() run past the end of the buffer.
    console.error("sub doc message sync missing context, drop frame");
    return;
  }
  const context = decoding.readVarString(decoder);
  const isJson = RdJsonUtil.hasJsonStructure(context);
  const docContext = isJson ? JSON.parse(context) : context;
  const docGuid = isJson ? docContext.doc_name : docContext;
  const doc = provider.getDoc(docGuid);
  if (!doc) {
    console.error("doc not found with id: ", docGuid);
    return;
  }

  if (!decoding.hasContent(decoder)) {
    // One-way frames (sync step2 / update) carry no reply. Older clients also
    // echoed the [type][context] header back, so such frames still show up on
    // the wire; drop them here, otherwise readSyncMessage() throws
    // "Unexpected end of array" on the empty decoder.
    console.error("sub doc message sync has no content, drop frame");
    return;
  }

  const uniqueValue = uuidv4();
  let msg: SyncMessageContext = {
    doc_name: docGuid,
    src: "messageHandlers",
    trace_id: uniqueValue,
    emitSynced: emitSynced,
    msg_type: "read_sync",
  };
  let msgStr = JSON.stringify(msg);
  let copiedDecoder = decoding.clone(decoder);
  if (!enableTracing()) {
    logYjsUnwrapMsg(copiedDecoder, docContext);
  }
  // Only sync step1 expects a reply; step2/update are one-way. Encode the reply
  // into a temporary encoder and prepend [type][context] only when there is an
  // actual reply, so this handler never emits a header-only frame.
  const replyEncoder = encoding.createEncoder();
  const syncMessageType = syncProtocol.readSyncMessage(
    decoder,
    replyEncoder,
    doc,
    provider
  );
  if (
    syncMessageType === syncProtocol.messageYjsSyncStep1 &&
    encoding.length(replyEncoder) > 0
  ) {
    encoding.writeVarUint(encoder, SyncMessageType.SubDocMessageSync);
    // convert to the legacy message without doc guid
    encoding.writeVarString(encoder, msgStr);
    encoding.writeUint8Array(encoder, encoding.toUint8Array(replyEncoder));
  }

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
  if (!decoding.hasContent(decoder)) {
    console.error("sync message has no content, drop frame");
    return;
  }
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
  if (!decoding.hasContent(decoder)) {
    console.error("awareness message has no content, drop frame");
    return;
  }
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
  if (!decoding.hasContent(decoder)) {
    console.error("auth message has no content, drop frame");
    return;
  }
  authProtocol.readAuthMessage(
    decoder,
    provider.doc,
    (_ydoc: any, reason: any) => permissionDeniedHandler(provider, reason)
  );
};
