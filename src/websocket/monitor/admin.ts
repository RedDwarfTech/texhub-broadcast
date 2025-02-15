import { instrument } from "@socket.io/admin-ui";
import { websocketServer } from "../../app";

export const init_monitor = () => {
  instrument(websocketServer, {
    auth: false,
    mode: "development",
  });
};
