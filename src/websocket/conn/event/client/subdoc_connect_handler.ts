import { SyncMessageType } from "@/model/texhub/sync_msg_type.js";
import { SocketIOClientProvider } from "../../socket_io_client_provider.js";
// @ts-ignore
import * as encoding from "rdlib0/encoding";
import { v4 as uuidv4 } from "uuid";
import { SyncMessageContext } from "@/model/texhub/sync_msg_context.js";
// @ts-ignore
import * as syncProtocol from "rdy-protocols/sync";
import { Socket } from "socket.io-client";
import { clientSendSyncStep1 } from "./client_prortocol_action.js";

export const handleSubdocConnect = (
  provider: SocketIOClientProvider,
  socketio: Socket
) => {
  for (const [k, doc] of provider.docs) {
    console.log("start sync for sub doc:" + k + ",count:" + provider.docs.size);
    if (doc.meta.id === "-1") {
      // this is a root document, we try to send the sync step 1 with the old style
      // we have to send the sync step 1 for the root document
      // so the server will response with step 2 and the sync events will be fired
      // then we can initialize the first texhub document
      // without the sync step 1, the editor will be empty for the first time
      clientSendSyncStep1(provider, socketio);
    } else {
      // this is a sub document, we send the sync step 1 with the sub doc message style
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, SyncMessageType.SubDocMessageSync);
      const uniqueValue = uuidv4();
      let msg: SyncMessageContext = {
        doc_name: k,
        src: "providerdocs",
        trace_id: uniqueValue,
      };
      let msgStr = JSON.stringify(msg);
      encoding.writeVarString(encoder, msgStr);
      syncProtocol.writeSyncStep1(encoder, doc);
      socketio.send(encoding.toUint8Array(encoder));
    }
  }
};
