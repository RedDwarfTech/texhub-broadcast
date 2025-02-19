import { messageListener } from "../ws_action";
import { Socket } from "socket.io";
import { WSSharedDoc } from "../../../yjs/ws_share_doc";

export const ws_msg_handle = (message: Uint8Array, conn: Socket, doc: WSSharedDoc) => {
  messageListener(conn, doc, new Uint8Array(message));
};
