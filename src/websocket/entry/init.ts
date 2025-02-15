import logger from "src/common/log4js_config.js"
import { initial_default } from "./conn/default_conn.js";
import { init_texconn } from "./conn/texhub_conn.js";

export const initialize = () => {
    logger.error("initial...");
    initial_default();
    init_texconn();
}
