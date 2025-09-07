// Main package entry point for external projects

// Export SingleClientProvider for external projects

import SingleClientProvider from "./websocket/conn/single_client_provider";
export { SingleClientProvider };

import { SocketIOClientProvider } from "./websocket/conn/socket_io_client_provider";
export { SocketIOClientProvider };

import { UpdateOrigin } from "./model/yjs/net/update_origin";
export { UpdateOrigin };

import { DocMeta } from "./model/yjs/commom/doc_meta";
export { DocMeta as DocMata };