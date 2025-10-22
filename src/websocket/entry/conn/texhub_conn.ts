import { Socket } from "socket.io";
import { websocketServer } from "@/app.js";
import { setupWSConnection } from "@/websocket/conn/event/server/server_setup_ws.js";

export const init_texconn = () => {
  let texhubNs = websocketServer.of("/texhub");

  texhubNs.on("connection", (socket: Socket) => {
    setupWSConnection(socket);
  });
};
