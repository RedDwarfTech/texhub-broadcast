import logger from "src/common/log4js_config"
import { initial_default } from "./conn/default_conn";

export const initialize = () => {
    logger.error("initial...");
    initial_default();
}
