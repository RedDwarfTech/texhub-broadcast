import { ManagerOptions, Socket, SocketOptions, io } from "socket.io-client";

export class MySocket {
  constructor(url: string, options?: Partial<ManagerOptions & SocketOptions>) {
    const doc: Socket = io(url, options);
    return doc;
  }
}
