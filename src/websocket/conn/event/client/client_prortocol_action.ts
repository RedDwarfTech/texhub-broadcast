import { SyncMessageType } from "@/model/texhub/sync_msg_type.js";
// @ts-ignore
import * as encoding from "rdlib0/encoding";
// @ts-ignore
import * as syncProtocol from "rdy-protocols/sync";
import { SocketIOClientProvider } from "../../socket_io_client_provider.js";
import { Socket } from "socket.io-client";

export const clientSendSyncStep1 = (
  provider: SocketIOClientProvider,
  socketio: Socket
) => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, SyncMessageType.SubDocMessageSync);
  syncProtocol.writeSyncStep1(encoder, provider.doc);
  socketio.send(encoding.toUint8Array(encoder));
};
