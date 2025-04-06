import { Socket } from "socket.io";
import http from "http";
import jwt from "jsonwebtoken";
import logger from "@common/log4js_config.js";
import { toJSON } from "flatted";
import { Server } from "socket.io";
const JWT_SIGN_KEY = process.env.JWT_SIGN_KEY || "key-missing";
const WEBSOCKET_AUTH_FAILED = 4000;
const WEBSOCKET_AUTH_TOKEN_EXPIRE = 4001;

export const handleMiddlewareAuthCheck = (websocketServer: Server) => {
  websocketServer.engine.use(
    (req: http.IncomingMessage, res: http.OutgoingMessage, next: Function) => {
      const access_token = new URL(
        req.url!,
        `http://${req.headers.host}`
      ).searchParams.get("access_token");
      jwt.verify(
        access_token || "default",
        JWT_SIGN_KEY,
        (err: any, decoded: any) => {
          if (err) {
            logger.error("valid token facing issue", err);
            return next(new Error("invalid token"));
          }
          next();
        }
      );
    }
  );
};

export const handleAuth = (
  request: http.IncomingMessage,
  conn: Socket
): boolean => {
  const url = new URL(request.url!, "wss://ws.poemhub.top");
  if (request.url !== "/healthz" && request.headers.host !== "127.0.0.1:1234") {
    // https://self-issued.info/docs/draft-ietf-oauth-v2-bearer.html#query-param
    const token = url.searchParams.get("access_token");
    const src = url.searchParams.get("from");
    try {
      jwt.verify(token!, JWT_SIGN_KEY);
      return true;
    } catch (err: any) {
      switch (err.name) {
        case "TokenExpiredError":
          conn.disconnect();
          return false;
        case "JsonWebTokenError":
          logger.error(
            "json web token facing error:" +
              err +
              ", request url:" +
              request.url +
              ",token:" +
              token +
              ",src=" +
              src
          );
          conn.disconnect();
          return false;
      }
    }
  }
  return false;
};
