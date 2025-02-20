import { Socket } from "socket.io";
import { websocketServer } from "../../../app.js";
import { setupWSConnection } from "../../config/setup.js";

export const init_texconn = () => {
  let texhubNs = websocketServer.of("/texhub");

  texhubNs.on("connection", (socket: Socket) => {
    setupWSConnection(socket, socket.request);
  });
};
