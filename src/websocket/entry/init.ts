import { runSyncLeveldbToPgTask } from "@common/async/run.js";
import { init_monitor } from "../monitor/admin.js";
import { init_routes } from "../route/sys_route.js";
import { initial_default } from "./conn/default_conn.js";
import { init_texconn } from "./conn/texhub_conn.js";
import { startWALWorker } from "@storage/wal/wal_update_handler.js";
import { initRedisAdapter } from "@common/sync/redis_adapter.js";

export const initialize = () => {
  // P1（docs/design/message-reliable.md §6.1）：务必在任何连接建立前挂载
  // Socket.IO Redis Adapter，room 广播才能跨实例路由。
  initRedisAdapter();
  init_routes();
  initial_default();
  init_texconn();
  init_monitor();
  runSyncLeveldbToPgTask("");
  // P0：WAL Worker（Redis Stream -> tex_sync 幂等消费），进程崩溃后可重放
  startWALWorker();
};
