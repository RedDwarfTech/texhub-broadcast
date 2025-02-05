import { Socket, io } from "socket.io-client";

export class MySocket {
  constructor(url: string) {
    const doc: Socket =  io(url);
    return doc;
  }
}
