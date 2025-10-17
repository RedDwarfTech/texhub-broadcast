
import { SocketIOClientProvider } from "../../socket_io_client_provider.js";
import { Socket } from "socket.io-client";
import { clientSendSyncStep1 } from "./client_prortocol_action.js";

/**
 * the first message after connection established will be missing
 * so we add the probe logic
 * @param socketio https://github.com/socketio/socket.io/issues/2273
 * @param onSuccess 
 */
function sendProbeWithAck(socketio: Socket, onSuccess: () => void) {
  const probeId = Math.random().toString(36).slice(2);
  let retryCount = 0;
  let acked = false;
  const maxRetry = 3;
  const retryInterval = 500; // ms
  console.log(`[probe] sending probe, probeId: ${probeId}`);

  const sendProbe = () => {
    if (acked) return;
    socketio.emit('probe', { probeId });
    retryCount++;
    if (retryCount < maxRetry && !acked) {
      setTimeout(sendProbe, retryInterval);
    } else if (!acked) {
      console.warn(`[probe] probe_ack not received, probeId: ${probeId} after ${maxRetry} attempts.`);
    }
  };

  const onProbeAck = (data: any) => {
    if (data && data.probeId === probeId) {
      acked = true;
      console.log(`[probe] received probe_ack, probeId: ${probeId}, data:`, data);
      socketio.off('probe_ack', onProbeAck);
      onSuccess();
    }
  };
  socketio.on('probe_ack', onProbeAck);
  setTimeout(sendProbe, 300);
}

export const handleSubdocConnect = (
  provider: SocketIOClientProvider,
  socketio: Socket
) => {
  sendProbeWithAck(socketio, () => {
    console.log('[probe] probe success, start batch sync for all docs');
    for (const [k, doc] of provider.docs) {
      if (doc.meta && doc.meta.id === "-1") {
        console.log(`[probe] sending clientSendSyncStep1 for root doc: ${k}`);
        clientSendSyncStep1(k, socketio, doc);
      } else {
        console.log(`[probe] sending clientSendSyncStep1 for sub doc: ${k}`);
        clientSendSyncStep1(k, socketio, doc);
      }
    }
  });
};
