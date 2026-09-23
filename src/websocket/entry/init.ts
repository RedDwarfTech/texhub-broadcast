import { runSyncLeveldbToPgTask } from "@common/async/run.js";
import { init_monitor } from "../monitor/admin.js";
import { init_routes } from "../route/sys_route.js";
import { initial_default } from "./conn/default_conn.js";
import { init_texconn } from "./conn/texhub_conn.js";
import { startWALWorker } from "@storage/wal/wal_update_handler.js";

export const initialize = () => {
  init_routes();
  initial_default();
  init_texconn();
  init_monitor();
  runSyncLeveldbToPgTask("");
  // P0：WAL Worker（Redis Stream -> tex_sync 幂等消费），进程崩溃后可重放
  startWALWorker();
};
