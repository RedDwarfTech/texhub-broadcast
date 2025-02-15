import { instrument } from "@socket.io/admin-ui";
import { websocketServer } from "app";

instrument(websocketServer, {
  auth: false,
  mode: "development",
});