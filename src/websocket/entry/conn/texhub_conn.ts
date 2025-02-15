import { websocketServer } from "app";
import logger from "common/log4js_config";
import { Server, Socket } from "socket.io";
import { setupWSConnection } from "websocket/config/setup";

let texhubNs = websocketServer.of("/texhub");

texhubNs.on("connection", (socket: Socket) => {
  if (logger.isDebugEnabled()) {
    logger.debug("connection....");
  }
  logger.info("connection status:" + socket.connected);
  setupWSConnection(socket, socket.request);
});

texhubNs.emit("hi", "everyone!");