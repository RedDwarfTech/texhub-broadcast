export enum SyncMessageType {
    /**
     * the document state message
     * the cursor location and so on
     */
    MessageAwareness = 1,
    MessageQueryAwareness = 3,
    /**
     * the message sync original defined by y-websocket
     * 
     */
    MessageSync = 0,
    /**
     * the sub document sync message type
     * we want to reuse the websocket connection
     * do not reconnect when we switch the collaboration document
     * so we define the independent message type
     * more info:
     * https://discuss.yjs.dev/t/extend-y-websocket-provider-to-support-sub-docs-synchronization-in-one-websocket-connection/1294
     * https://docs.yjs.dev/api/subdocuments
     */
    SubDocMessageSync = 22,
    /**
     * define the control message type
     * for example: switch document
     * 
     */
    MessageControl = 21
}