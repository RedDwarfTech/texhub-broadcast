import log4js, { Configuration } from "log4js";

let logger: any;

if (typeof window === 'undefined') {
  // Node.js environment
  const logConfig: Configuration = {
    appenders: {
      out: {
        type: "stdout",
        layout: {
          type: "pattern",
          pattern: "%d [%p] %f{2}:%l - %m",
        },
      },
      files: {
        type: "file",
        filename: "testing.log",
        layout: {
          type: "pattern",
          pattern: "%d [%p] %f{2}:%l - %m",
        },
      },
    },
    categories: {
      default: {
        appenders: ["out", "files"],
        level: "all",
        // https://stackoverflow.com/questions/79536525/is-it-possible-to-output-the-full-callstack-in-nodejs
        enableCallStack: true,
      },
    },
    disableClustering: true,
  };
  
  log4js.configure(logConfig);
  logger = log4js.getLogger();
  logger.level = "all";
} else {
  // Browser environment
  // Create a minimal logger implementation for browser compatibility
  logger = {
    trace: console.log,
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
    fatal: console.error,
    // Add a noop level property to prevent errors
    set level(_) {},
    get level() { return "all"; }
  };
}

export default logger;
