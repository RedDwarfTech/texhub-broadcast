import { SocketIOClientProvider } from "../../socket_io_client_provider.js";
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
      clientSendSyncStep1(k, socketio, doc);
    } else {
      // this is a sub document, we send the sync step 1 with the sub doc message style
      clientSendSyncStep1(k, socketio, doc);
    }
  }
};
