import { SyncMessageType } from "@model/texhub/sync_msg_type.js";
import { SocketIOClientProvider } from "../socket_io_client_provider.js";
import * as decoding from "lib0/decoding";
// @ts-ignore
import * as encoding from "lib0/encoding";
// @ts-ignore
import * as syncProtocol from "rdy-protocols/sync";
// @ts-ignore
import * as authProtocol from "rdy-protocols/auth";
import {
  writeVarUint,
  writeVarUint8Array,
  // @ts-ignore
} from "lib0/dist/encoding.cjs";
import {
  readVarUint8Array,
  // @ts-ignore
} from "lib0/dist/decoding.cjs";
// @ts-ignore
import * as awarenessProtocol from "rdy-protocols/awareness";

export const messageHandlers: any[] = [];

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
  emitSynced: any,
  messageType: any
) => {
  const docGuid = decoding.readVarString(decoder);
  const doc = provider.getDoc(docGuid);
  if (!doc) {
    console.error("doc not found with id: ", docGuid);
    return;
  }

  encoding.writeVarUint(encoder, SyncMessageType.SubDocMessageSync);
  encoding.writeVarString(encoder, docGuid);
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
    !provider.synced
  ) {
    provider.synced = true;
  }

  // sub doc synced
  if (
    emitSynced &&
    docGuid !== provider.roomname &&
    syncMessageType === syncProtocol.messageYjsSyncStep2 &&
    !provider.syncedStatus.get(docGuid)
  ) {
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
    !provider.synced
  ) {
    provider.synced = true;
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
  authProtocol.readAuthMessage(decoder, provider.doc, (_ydoc: any, reason: any) =>
    permissionDeniedHandler(provider, reason)
  );
};
