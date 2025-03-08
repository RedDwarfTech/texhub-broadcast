import { runSyncLeveldbToPgTask } from "../../common/async/run.js";
import { init_monitor } from "../monitor/admin.js";
import { init_routes } from "../route/sys_route.js";
import { initial_default } from "./conn/default_conn.js";
import { init_texconn } from "./conn/texhub_conn.js";

export const initialize = () => {
  init_routes();
  initial_default();
  init_texconn();
  init_monitor();
  // runSyncLeveldbToPgTask("");
};
