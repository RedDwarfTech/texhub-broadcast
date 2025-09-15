import { messageListener } from "../ws_action.js";
import { Socket } from "socket.io";
import { WSSharedDoc } from "@collar/ws_share_doc.js";

export const ws_msg_handle = (
  message: Uint8Array,
  conn: Socket,
  rootDoc: WSSharedDoc
) => {
  messageListener(conn, rootDoc, new Uint8Array(message));
};
