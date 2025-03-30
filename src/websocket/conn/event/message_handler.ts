import { messageListener } from "../ws_action.js";
import { Socket } from "socket.io";
import { WSSharedDoc } from "@collar/ws_share_doc.js";

export const ws_msg_handle = (message: Uint8Array, conn: Socket, doc: WSSharedDoc) => {
  messageListener(conn, doc, new Uint8Array(message));
};
