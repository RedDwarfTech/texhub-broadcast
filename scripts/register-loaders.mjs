import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("ts-node/esm", pathToFileURL("./"));
register("esm-module-alias/loader", pathToFileURL("./"));
