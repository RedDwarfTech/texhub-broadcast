import { instrument } from "@socket.io/admin-ui";
import { websocketServer } from "../../app.js";

export const init_monitor = () => {
  instrument(websocketServer, {
    auth: false,
    mode: "development",
  });
};
