import logger from "../../common/log4js_config.js"
import { init_monitor } from "../monitor/admin.js";
import { initial_default } from "./conn/default_conn.js";
import { init_texconn } from "./conn/texhub_conn.js";

export const initialize = () => {
    logger.error("initial...");
    initial_default();
    init_texconn();
    init_monitor();
}
