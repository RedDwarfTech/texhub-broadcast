import log4js, { Configuration } from "log4js";
let logConfig: Configuration = {
  appenders: {
    out: {
      type: "stdout",
      layout: {
        type: "colored",
      },
    },
    files: {
      type: "file",
      filename: "testing.log",
    },
  },
  categories: {
    default: {
      appenders: ["out", "files"],
      level: "all",
    },
  },
  disableClustering: true,
};
log4js.configure(logConfig);
let logger = log4js.getLogger();
logger.level = "all";
export default logger;
