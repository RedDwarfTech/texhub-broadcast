import { iterateAllKeys } from "../../common/migration/leveldb_to_postgresql.js";
import { init_monitor } from "../monitor/admin.js";
import { init_routes } from "../route/sys_route.js";
import { initial_default } from "./conn/default_conn.js";
import { init_texconn } from "./conn/texhub_conn.js";

export const initialize = () => {
  init_routes();
  initial_default();
  init_texconn();
  init_monitor();
  iterateAllKeys()
    .then(() => {
      console.log("Iteration completed.");
    })
    .catch((err: Error) => {
      console.error("Error during iteration:", err);
    });
};
