import express from "express";
import { Server } from "socket.io";
import http from "http";
const PORT = 1234;
export const app = express();
var httpServer = http.createServer(app);

// websocket
export const websocketServer = new Server(httpServer, {
  cors: {
    origin: [
      "https://socket.poemhub.top",
      "https://tex.poemhub.top",
      "https://admin.socket.io",
    ],
    credentials: true,
    allowedHeaders: ["*"],
    methods: ["GET", "HEAD", "OPTIONS", "POST"],
  },
  path: "/sync",
});

httpServer.listen(PORT);