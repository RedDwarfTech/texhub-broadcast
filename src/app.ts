import express from "express";
import { Server, Socket } from "socket.io";
import http from "http";
import 'dotenv/config';
import { initialize } from "./websocket/entry/init.js";
import { handleMiddlewareAuthCheck } from "./websocket/entry/handle/auth.js";
const PORT = 1234;
export const app = express();
var httpServer = http.createServer(app);
"_moduleAliases": {
  "@": ".",//这个@就表示根目录
  "api": "./api",//你也可以自定义一个标记，比如用api指定根目录下面的api文件夹，其他的都可以直接来指定
}
// websocket
export const websocketServer: Server = new Server(httpServer, {
  cors: {
    origin: [
      "https://socket.poemhub.top",
      "https://tex.poemhub.top",
      "https://admin.socket.io",
      "chrome-extension://ophmdkgfcjapomjdpfobjfbihojchbko",
      "http://192.168.1.6:3003"
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

handleMiddlewareAuthCheck(websocketServer);

initialize();
httpServer.listen(PORT);