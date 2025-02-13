import express from "express";
import { setupWSConnection } from "./websocket/config/setup.js";
import { Server, Socket } from "socket.io";
import http from "http";
import { routerHealth } from "./controller/health/health_controller.js";
import { routerDoc } from "./controller/doc/doc_controller.js";
import { routerMetrics } from "./controller/profile/metrics_controller.js";
import { routerProfile } from "./controller/profile/profile_controller.js";
import logger from "./common/log4js_config.js";
import { instrument } from "@socket.io/admin-ui";
import { toJSON } from "flatted";
const PORT = 1234;
const app = express();

app.use(express.json());
app.use("/health", routerHealth);
app.use("/doc", routerDoc);
app.use("/profile", routerMetrics);
app.use("/metrics", routerProfile);
var httpServer = http.createServer(app);

// websocket
const websocketServer = new Server(httpServer, {
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
  path: "/socket.io/",
});

instrument(websocketServer, {
  auth: false,
  mode: "development",
});

let texhubNs = websocketServer.of("/texhub");

texhubNs.on("connection", (socket: Socket) => {
  console.log("someone connected");
});

texhubNs.emit("hi", "everyone!");

websocketServer.on("connection", (socket: Socket) => {
  if (logger.isDebugEnabled()) {
    logger.debug("connection....");
  }
  logger.info("connection status:" + socket.connected);
  setupWSConnection(socket, socket.request);
});

websocketServer.engine.on("connection_error", (err: any) => {
  logger.error("engine error:" + err.req); // the request object
  logger.error("engine error:" + err.code); // the error code, for example 1
  logger.error("engine error:" + err.message); // the error message, for example "Session ID unknown"
  logger.error("engine error:" + err.context); // some additional error context
  logger.error(typeof err);
  logger.error(toJSON(err));
});
httpServer.listen(PORT);
