export interface SyncMessageContext {
    /**
     * document uniq uuid
     */
    doc_name: string;
    /**
     * document id int64
     */
    doc_int_id?: string;
    /**
     * the message come from
     */
    src: string;
    /**
     * the message uniq trace id
     */
    trace_id: string;
    /**
     * whether emit synced event when main doc synced
     */
    emitSynced?: boolean;
    /**
     * project id, used for multi-tenant
     */
    project_id?: string;
    /**
     * msg type, reserved field
     */
    msg_type?: string;
    /**
     * P0 Outbox：客户端本地 update 的单调序号，服务端应用成功后回 `sync:ack { doc, seq }`
     */
    seq?: number;
}