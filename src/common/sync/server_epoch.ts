/**
 * P1（docs/design/message-reliable.md §6.3）：会话一致性 serverEpoch。
 *
 * 每次进程启动生成一个单调递增的 epoch（优先取运维注入的 SERVER_EPOCH，
 * 便于滚动发布时按 release 固定）。客户端在连接握手中拿到该值后与本地缓存
 * 对比：若不一致说明服务器已重启（内存态 Yjs doc、房间成员、Outbox 确认态
 * 全部失效），必须走完整对账（重放 Outbox + sync step1）。
 */
const resolveServerEpoch = (): number => {
  const fromEnv = process.env.SERVER_EPOCH;
  if (fromEnv && /^\d+$/.test(fromEnv)) {
    return Number(fromEnv);
  }
  return Date.now();
};

export const SERVER_EPOCH: number = resolveServerEpoch();