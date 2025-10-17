import { SocketIOClientProvider } from "../../socket_io_client_provider.js";
import { Socket } from "socket.io-client";
import { clientSendSyncStep1 } from "./client_prortocol_action.js";

export const handleSubdocConnect = (
  provider: SocketIOClientProvider,
  socketio: Socket
) => {
  for (const [k, doc] of provider.docs) {
    console.log(`[probe] start sync for sub doc: ${k}, count: ${provider.docs.size}, socket connected: ${socketio.connected}`);
    // 发送探测消息，等待服务端响应
    const probeId = Math.random().toString(36).slice(2);
    console.log(`[probe] sending probe for doc: ${k}, probeId: ${probeId}`);
    socketio.emit('probe', { doc: k, probeId });

    // 只监听一次 probe_ack，避免重复
    const onProbeAck = (data: any) => {
      if (data && data.doc === k && data.probeId === probeId) {
        console.log(`[probe] received probe_ack for doc: ${k}, probeId: ${probeId}, data:`, data);
        if (doc.meta && doc.meta.id === "-1") {
          console.log(`[probe] sending clientSendSyncStep1 for root doc: ${k}`);
          clientSendSyncStep1(k, socketio, doc);
        } else {
          console.log(`[probe] sending clientSendSyncStep1 for sub doc: ${k}`);
          clientSendSyncStep1(k, socketio, doc);
        }
        socketio.off('probe_ack', onProbeAck);
      }
    };
    socketio.on('probe_ack', onProbeAck);
  }
};
