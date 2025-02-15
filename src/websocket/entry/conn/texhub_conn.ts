import { Socket } from "socket.io";
import { websocketServer } from "src/app";
import logger from "src/common/log4js_config";
import { setupWSConnection } from "src/websocket/config/setup";

let texhubNs = websocketServer.of("/texhub");

texhubNs.on("connection", (socket: Socket) => {
  if (logger.isDebugEnabled()) {
    logger.debug("connection....");
  }
  logger.info("connection status:" + socket.connected);
  setupWSConnection(socket, socket.request);
});

texhubNs.emit("hi", "everyone!");
