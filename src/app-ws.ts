import { Server, WebSocketServer } from "ws";

const webSocketServer = new WebSocketServer({ port: 8080 });

// websocket
webSocketServer.on("connection", setupWSConnection);

export function setupWSConnection(conn: WebSocket, req: any) {
  conn.binaryType = "arraybuffer";
  // conn.on("message", (message: WebSocket.RawData) => {});
}
