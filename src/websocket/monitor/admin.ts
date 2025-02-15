import { instrument } from "@socket.io/admin-ui";
import { websocketServer } from "src/app";

instrument(websocketServer, {
  auth: false,
  mode: "development",
});