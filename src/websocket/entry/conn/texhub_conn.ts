import { Socket } from "socket.io";
import { websocketServer } from "src/app.js";
import logger from "src/common/log4js_config.js";
import { setupWSConnection } from "src/websocket/config/setup.js";

export const init_texconn = () => {
  let texhubNs = websocketServer.of("/texhub");

  texhubNs.on("connection", (socket: Socket) => {
    if (logger.isDebugEnabled()) {
      logger.debug("connection....");
    }
    logger.info("connection status:" + socket.connected);
    setupWSConnection(socket, socket.request);
  });

  texhubNs.emit("hi", "everyone!");
};