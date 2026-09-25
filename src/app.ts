import express, { Express } from "express";
import { Server, Socket } from "socket.io";
import http from "http";
import "dotenv/config";
import { initialize } from "@websocket/entry/init.js";
import { handleMiddlewareAuthCheck } from "@websocket/entry/handle/auth.js";
import { registerRoomServer } from "@common/sync/room_broadcast.js";
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
  // P1（docs/design/message-reliable.md §6.1/§6.2）：支持连接状态恢复。
  // 短暂断线（<2min）重连后自动恢复房间成员与已 emit 参数；但注意服务器重启后
  // 内存态会丢失，客户端以 sync:epoch 兜底做完整对账。
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
  },
});

websocketServer.use((socket: Socket, next) => {
  if (!socket.handshake) {
    //logger.error("auth token is missing");
    return next(new Error("1auth token is missing"));
  }
  // If everything is fine, call next without arguments
  next();
});

handleMiddlewareAuthCheck(websocketServer);

// P1（docs/design/message-reliable.md §6.1）：把 Server 实例注入 room 广播模块。
// 必须在此注册（bundle 侧的 provider 依赖 room_broadcast，但绝不能反向引用 app）。
registerRoomServer(websocketServer);

initialize();
process.on("uncaughtException", (error, origin) => {
  // https://stackoverflow.com/questions/17245881/how-do-i-debug-error-econnreset-in-node-js
  logger.error("uncaughtException", error, origin, error.stack);
});
httpServer.listen(PORT);
