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
}