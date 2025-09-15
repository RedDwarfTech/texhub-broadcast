import { messageListener } from "../ws_action.js";
import { Socket } from "socket.io";
import { WSSharedDoc } from "@collar/ws_share_doc.js";
import { redis } from "@/common/cache/redis_util.js";

export const ws_msg_handle = (message: Uint8Array, conn: Socket, rootDoc: WSSharedDoc) => {
  (async () => {
    let crypto;
    try {
      crypto = await import("crypto");
    } catch (e) {
      console.warn("crypto import failed", e);
      messageListener(conn, rootDoc, new Uint8Array(message));
      return;
    }
    const updateHash = crypto.createHash("sha256").update(message).digest("hex");
    // Redis去重key
    const redisKey = `wsmsg_updatehash:${rootDoc.name}:${updateHash}`;
    if (redis) {
      const exists = await redis.get(redisKey);
      if (exists) {
        console.warn(`[ws_msg_handle] 检测到重复消息，hash=${updateHash}, doc=${rootDoc.name}, connId=${conn.id}, messageLen=${message.length}`);
        console.warn(`[ws_msg_handle] 上下文:`, {
          docName: rootDoc.name,
          connId: conn.id,
          messageLen: message.length,
          message: message,
        });
        return;
      }
      await redis.set(redisKey, "1", "EX", 86400);
    }
    messageListener(conn, rootDoc, new Uint8Array(message));
  })();
};
