import { ManagerOptions, Socket, SocketOptions } from "socket.io-client";
export type WsParam = {
  new (url: string, options?: Partial<ManagerOptions & SocketOptions>): Socket;
};
