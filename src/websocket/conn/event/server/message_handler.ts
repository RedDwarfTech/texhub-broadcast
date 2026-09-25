import { messageListener } from "../../action/ws_action.js";
import { Socket } from "socket.io";
import { WSSharedDoc } from "@collar/ws_share_doc.js";
import { SyncFileAttr } from "@/model/texhub/sync_file_attr.js";

export const enqueueSocketTask = (conn: Socket, task: () => Promise<void>) => {
  const previous = (conn as any).__socketTaskQueue || Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(task)
    .catch(() => undefined);
  (conn as any).__socketTaskQueue = current;
  return current;
};

export const ws_msg_handle = (
  message: Uint8Array,
  conn: Socket,
  rootDoc: WSSharedDoc,
  syncFileAttr: SyncFileAttr
) => {
  return enqueueSocketTask(conn, () =>
    messageListener(conn, rootDoc, new Uint8Array(message), syncFileAttr)
  );
};
