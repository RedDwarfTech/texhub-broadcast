/**
 * 滚动查询结果的通用接口
 * @template T 查询结果的数据类型
 */
export interface ScrollQueryResult<T> {
  /** 当前页的数据项 */
  items: T[];
  /** 下一页的游标，如果没有更多数据则为 null */
  nextCursor: string | null;
  /** 是否还有更多数据 */
  hasMore: boolean;
} 