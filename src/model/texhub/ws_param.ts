import { Socket } from "socket.io";

export type WsParam = { 
    new (url: string | URL, protocols?: string | string[]): Socket;
    prototype: Socket;
    readonly CONNECTING: 0;
    readonly OPEN: 1;
    readonly CLOSING: 2;
    readonly CLOSED: 3;
}