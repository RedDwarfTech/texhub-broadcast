import { Op } from 'sequelize';
import { ProjectScrollVersion } from '@/model/texhub/project_scroll_version.js';
import { ScrollQueryResult } from '@/common/types/scroll_query.js';
import logger from '@/common/log4js_config.js';

/**
 * 获取项目滚动版本
 * @param projectId 项目ID
 * @param cursor 游标（可选）
 * @param limit 每页数量
 * @returns 包含版本列表和下一页游标的结果
 */
export const getProjectScrollVersion = async (
  projectId: string,
  cursor?: string,
  limit: number = 20
): Promise<ScrollQueryResult<ProjectScrollVersion>> => {
  try {
    // 构建查询条件
    const whereClause: any = {
      project_id: projectId,
    };

    // 如果有游标，添加游标条件
    if (cursor) {
      const decodedCursor = Buffer.from(cursor, 'base64').toString();
      const [timestamp, id] = decodedCursor.split('_');
      whereClause[Op.or] = [
        {
          created_time: {
            [Op.lt]: new Date(parseInt(timestamp)),
          },
        },
        {
          created_time: new Date(parseInt(timestamp)),
          id: {
            [Op.lt]: parseInt(id),
          },
        },
      ];
    }

    // 执行查询
    const versions = await ProjectScrollVersion.findAll({
      where: whereClause,
      order: [
        ['created_time', 'DESC'],
        ['id', 'DESC'],
      ],
      limit: limit + 1, // 多查询一条用于判断是否还有更多
    });

    // 处理结果
    const hasMore = versions.length > limit;
    const items = hasMore ? versions.slice(0, limit) : versions;

    // 生成下一页游标
    let nextCursor: string | null = null;
    if (hasMore) {
      const lastItem = items[items.length - 1];
      const cursorString = `${lastItem.created_time.getTime()}_${lastItem.id}`;
      nextCursor = Buffer.from(cursorString).toString('base64');
    }

    return {
      items,
      nextCursor,
      hasMore,
    };
  } catch (error) {
    logger.error('Failed to get project scroll versions:', error);
    throw error;
  }
};



