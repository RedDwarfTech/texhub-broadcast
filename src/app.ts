import express from "express";
import { setupWSConnection } from "./websocket/config/setup";
import { Server, Socket } from "socket.io";
import http from "http";
import { routerHealth } from "./controller/health/health_controller";
import { routerDoc } from "./controller/doc/doc_controller";
import { routerMetrics } from "./controller/profile/metrics_controller";
import { routerProfile } from "./controller/profile/profile_controller";
import logger from "./common/log4js_config";
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
    origin: "https://tex.poemhub.top",
  },
});

websocketServer.on("connection", (socket: Socket) => {
  if (logger.isDebugEnabled()) {
    logger.debug("connection....");
  }
  logger.warn("connection warning....");
  setupWSConnection(socket, socket.request);
});

httpServer.listen(PORT);
