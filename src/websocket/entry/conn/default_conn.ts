import logger from "../../../common/log4js_config";
import { toJSON } from "flatted";
import { Socket } from "socket.io";
import { websocketServer } from "src/app";

export const initial_default = () => {
  logger.error("initial default...");
  websocketServer.on("connection", (socket: Socket) => {
    logger.warn("connection...");
  });

  websocketServer.engine.on("connection_error", (err: any) => {
    logger.error("engine error:" + err.req); // the request object
    logger.error("engine error:" + err.code); // the error code, for example 1
    logger.error("engine error:" + err.message); // the error message, for example "Session ID unknown"
    logger.error("engine error:" + err.context); // some additional error context
    logger.error(typeof err);
    logger.error(toJSON(err));
  });
};
