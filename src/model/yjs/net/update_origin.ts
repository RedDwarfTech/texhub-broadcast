export interface UpdateOrigin {
    name: string;
    origin: string;
    userId?: string;           // 操作用户ID
    userName?: string;         // 用户名
    operationType?: string;    // 操作类型: "edit" | "delete" | "auto_clear" | "sync" 等
    timestamp?: number;        // 操作时间戳
    reason?: string;           // 操作原因描述
    sessionId?: string;        // 会话ID
    clientInfo?: string;       // 客户端信息
}