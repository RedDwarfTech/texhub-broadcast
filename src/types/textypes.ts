import { ManagerOptions, Socket, SocketOptions, io } from "socket.io-client";

export class MySocket {
  constructor(url: string, options?: Partial<ManagerOptions & SocketOptions>) {
    console.log("initial the websocket...." + url);
    const doc: Socket = io(url, options);
    return doc;
  }
}
