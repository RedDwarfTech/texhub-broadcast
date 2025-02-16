import { Socket } from "socket.io";
import { websocketServer } from "../../../app.js";
import logger from "../../../common/log4js_config.js";
import { setupWSConnection } from "../../../websocket/config/setup.js";
import { toJSON } from "flatted";

export const init_texconn = () => {
  let texhubNs = websocketServer.of("/texhub");

  texhubNs.on("connection", (socket: Socket) => {
    if (logger.isDebugEnabled()) {
      logger.debug("connection....");
    }
    logger.info("connection:" + toJSON(socket));
    setupWSConnection(socket, socket.request);
  });

  texhubNs.emit("hi", "everyone!");
};
