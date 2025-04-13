import { SocketIOClientProvider } from "@/websocket/conn/socket_io_client_provider";

export type MessageHandler = (
    encoder: any,
    decoder: any,
    provider: SocketIOClientProvider,
    emitSynced: boolean,
    messageType: number
  ) => void;