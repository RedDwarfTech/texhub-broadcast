import type { Server, Socket } from "socket.io";
import logger from "@common/log4js_config.js";

const ROOM_PREFIX = "doc:" as const;

let roomServer: Server | null = null;
let texhubNs: ReturnType<Server["of"]> | null = null;

/**
 * 由服务端启动入口（src/app.ts，websocketServer 创建完成后）注入 Socket.IO
 * Server 实例。
 *
 * 注意：不能在这里 `import { websocketServer } from "@/app.js"`——room_broadcast
 * 处于客户端 provider 的打包图内（ws_action -> yjs_utils -> room_broadcast），
 * 静态引用服务端入口会把整条 server 链（含 y-leveldb 等 Node 依赖）拖入前端
 * bundle。改为注册注入后，浏览器端打包时 roomServer 为 null，广播函数不会执行。
 */
export const registerRoomServer = (server: Server) => {
  roomServer = server;
  texhubNs = null;
};

/**
 * 惰性获取 /texhub namespace：首次调用时 app.ts 一定已完成启动并注册 server。
 */
const getTexhubNamespace = () => {
  if (!roomServer) {
    logger.warn("[room] server not registered, broadcast dropped");
    return null;
  }
  if (!texhubNs) {
    texhubNs = roomServer.of("/texhub");
  }
  return texhubNs;
};

/**
 * P1（docs/design/message-reliable.md §6.1）：Room 化广播基础设施。
 * 以"文档 room"替代原先遍历 `doc.conns` 的 O(n) 广播：
 * - root doc 使用根房间（projectId 或 docId），连接建立时一次性 join；
 * - subdoc 使用子文档 GUID，连接在首次收到该子文档消息时 join；
 * - 配合 Redis Adapter，`to(room).emit` 自动覆盖全部实例，单实例拓扑下
 *   退化为直发本实例连接，行为与改造前等价。
 */

/**
 * 生成文档 room 名称（项目房间/根文档房间共用同一命名空间前缀，避免与
 * subdoc 房间混淆；subdoc 房间直接用 GUID 本身）。
 */
export const toDocRoom = (name: string): string => `${ROOM_PREFIX}${name}`;

export const joinDocRoom = (socket: Socket, room: string) => {
  if (!socket || !room) return;
  try {
    if (!socket.rooms.has(room)) {
      socket.join(room);
    }
  } catch (e: any) {
    logger.warn(`[room] join failed room=${room}`, e);
  }
};

export const leaveDocRoom = (socket: Socket, room: string) => {
  if (!socket || !room) return;
  try {
    if (socket.rooms.has(room)) {
      socket.leave(room);
    }
  } catch (e: any) {
    logger.warn(`[room] leave failed room=${room}`, e);
  }
};

/**
 * 向文档 room 广播一条 Uint8Array 消息（客户端 `message` 事件）。
 * 若指定 exceptSocketId，则排除发起者（subdoc 广播需要保持"主动用户不收到回显"
 * 的既有语义）。
 */
export const broadcastToDocRoom = (
  room: string,
  message: Uint8Array,
  exceptSocketId?: string
) => {
  try {
    const ns = getTexhubNamespace();
    if (!ns) return;
    const buf = Buffer.from(message);
    if (exceptSocketId) {
      ns.to(room).except(exceptSocketId).emit("message", buf);
    } else {
      ns.to(room).emit("message", buf);
    }
  } catch (e: any) {
    logger.error(`[room] broadcast failed room=${room}`, e);
  }
};