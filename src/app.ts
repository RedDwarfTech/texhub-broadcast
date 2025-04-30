import express, { Express } from "express";
import { Server, Socket } from "socket.io";
import http from "http";
import "dotenv/config";
import { initialize } from "@websocket/entry/init.js";
import { handleMiddlewareAuthCheck } from "@websocket/entry/handle/auth.js";
import logger from "@common/log4js_config.js";
const PORT = 1234;
export const app: Express = express();
var httpServer = http.createServer(app);

// websocket
export const websocketServer: Server = new Server(httpServer, {
  cors: {
    origin: [
      "https://socket.poemhub.top",
      "https://tex.poemhub.top",
      "https://admin.socket.io",
      "chrome-extension://ophmdkgfcjapomjdpfobjfbihojchbko",
      "http://192.168.1.6:3003",
      "http://192.168.1.7:3003"
    ],
    credentials: true,
    allowedHeaders: ["*"],
    methods: ["GET", "HEAD", "OPTIONS", "POST"],
  },
  path: "/sync",
});

websocketServer.use((socket: Socket, next) => {
  if (!socket.handshake) {
    //logger.error("auth token is missing");
    return next(new Error("1auth token is missing"));
  }
  // If everything is fine, call next without arguments
  next();
});

//handleMiddlewareAuthCheck(websocketServer);

initialize();
process.on("uncaughtException", (error, origin) => {
  // https://stackoverflow.com/questions/17245881/how-do-i-debug-error-econnreset-in-node-js
  logger.error("uncaughtException", error, origin, error.stack);
});
httpServer.listen(PORT);
