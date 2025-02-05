import { Socket } from "socket.io-client";
export type WsParam = { 
    new (url: string): Socket;
}