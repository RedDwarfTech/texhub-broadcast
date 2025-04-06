import logger from "@common/log4js_config.js";
import { toJSON } from "flatted";
import { Socket } from "socket.io";
import { websocketServer } from "../../../app.js";
import { EngineConnErr } from "@model/socketio/engine_conn_err.js";

export const initial_default = () => {
  websocketServer.on("connection", (socket: Socket) => {
    logger.warn("connection...");
  });

  websocketServer.engine.on("connection_error", (err: EngineConnErr) => {
    logger.error("engine error:" + err.req); // the request object
    logger.error("engine error:" + err.code); // the error code, for example 1
    logger.error("engine error:" + err.message); // the error message, for example "Session ID unknown"
    logger.error(typeof err);
    // logger.error(toJSON(err));
  });
};
