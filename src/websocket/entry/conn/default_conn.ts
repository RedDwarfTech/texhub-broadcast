import logger from "@common/log4js_config.js";
import { toJSON } from "flatted";
import { Socket } from "socket.io";
import { websocketServer } from "@/app.js";
import { EngineConnErr } from "@model/socketio/engine_conn_err.js";

export const initial_default = () => {
  websocketServer.on("connection", (socket: Socket) => {
    logger.warn("connection...");
    
    // 监听断开连接事件
    socket.on("disconnect", (reason) => {
      logger.warn(`Client disconnected: ${socket.id}, reason: ${reason}`);
    });

    // 监听错误事件
    socket.on("error", (error) => {
      logger.error(`Socket error for client ${socket.id}:`, error);
    });

    // 监听重连尝试
    socket.on("reconnect_attempt", (attempt) => {
      logger.info(`Client ${socket.id} attempting to reconnect, attempt ${attempt}`);
    });

    // 监听重连成功
    socket.on("reconnect", (attempt) => {
      logger.info(`Client ${socket.id} reconnected after ${attempt} attempts`);
    });

    // 监听重连失败
    socket.on("reconnect_failed", () => {
      logger.error(`Client ${socket.id} failed to reconnect`);
    });
  });

  websocketServer.engine.on("connection_error", (err: EngineConnErr) => {
    logger.error("engine error:" + err.req); // the request object
    logger.error("engine error:" + err.code); // the error code, for example 1
    logger.error("engine error:" + err.message); // the error message, for example "Session ID unknown"
    logger.error(typeof err);
    // logger.error(toJSON(err));
  });
};
