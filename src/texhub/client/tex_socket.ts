import { ManagerOptions, Socket, SocketOptions, io } from "socket.io-client";

export class TeXSocket {
  constructor(url: string, options?: Partial<ManagerOptions & SocketOptions>) {
    console.log("initial the websocket...." + url);
    const socket: Socket = io(url, options);
    socket.on("connect_error", (err: any) => {
      // the reason of the error, for example "xhr poll error"
      console.log(err.message);

      // some additional description, for example the status code of the initial HTTP response
      console.log(err.description);

      // some additional context, for example the XMLHttpRequest object
      console.log(err.context);
    });
    return socket;
  }
}
