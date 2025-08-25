let Op: any;
if (typeof window === "undefined") {
  Op = (await import("sequelize")).Op;
}
import {
  ProjectScrollVersion,
  ProjectScrollVersionAttributes,
} from "@/model/texhub/project_scroll_version.js";
import { ScrollQueryResult } from "@/common/types/scroll_query.js";
import logger from "@/common/log4js_config.js";
// @ts-ignore
import * as Y from "rdyjs";
import { UpdateOrigin } from "@/model/yjs/net/update_origin";
import { MAX_I64 } from "@/common/app/global_constant.js";

export const getProjectVersionDetail = async (
  id: string
): Promise<ProjectScrollVersionAttributes> => {
  try {
    const version = await ProjectScrollVersion.findByPk(parseInt(id));
    if (!version) {
      throw new Error(`Version with id ${id} not found`);
    }
    return version.get({ plain: true });
  } catch (error) {
    logger.error("Failed to get project version detail:", error);
    throw error;
  }
};

/**
 * 获取项目滚动版本
 * @param projectId 项目ID
 * @param cursor 游标（可选）
 * @param limit 每页数量
 * @returns 包含版本列表和下一页游标的结果
 */
export const getProjectScrollVersion = async (
  projectId: string,
  fileId: string,
  cursor?: string,
  limit: number = 20
): Promise<ScrollQueryResult<ProjectScrollVersionAttributes>> => {
  try {
    const whereClause: any = {
      project_id: projectId,
    };
    if (cursor) {
      let lastId = BigInt(cursor) > MAX_I64 ? MAX_I64 : BigInt(cursor);
      whereClause.id = { [Op.lt]: lastId };
    }
    if (fileId) {
      whereClause.doc_int_id = fileId;
    }
    const versions = await ProjectScrollVersion.findAll({
      where: whereClause,
      order: [["created_time", "DESC"]],
      limit: limit + 1,
    });
    const plainVersions = versions.map((v: any) => v.get({ plain: true }));
    const hasMore = plainVersions.length > limit;
    const items = hasMore ? plainVersions.slice(0, limit) : plainVersions;
    let nextCursor: string | null = null;
    if (hasMore) {
      const lastItem = items[items.length - 1];
      nextCursor = String(lastItem.id);
    }

    return {
      items,
      nextCursor,
      hasMore,
    };
  } catch (error) {
    logger.error("Failed to get project scroll versions:", error);
    throw error;
  }
};

export const calcFileVersion = async (fileId: string) => {
  try {
    const versions = (await Promise.race([
      ProjectScrollVersion.findAll({
        where: {
          doc_name: fileId,
        },
        order: [["created_time", "ASC"]],
        limit: 1000, // 限制最多返回1000条记录
        logging: (sql: any, timing: any) => {
          if (timing && timing > 5000) {
            // 记录执行时间超过5秒的查询
            logger.warn(
              `Slow query detected for file ${fileId}, execution time: ${timing}ms`
            );
          }
        },
      }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Query timeout after 10 seconds")),
          10000
        )
      ),
    ])) as ProjectScrollVersionAttributes[];

    if (!versions || versions.length === 0) {
      return [];
    }

    // 找到最近的snapshot
    const latestSnapshot = await getFileLatestSnapshot(fileId);
    if (!latestSnapshot) {
      logger.warn(`No snapshot found for file ${fileId}`);
      return [];
    }

    // 找到snapshot在版本列表中的位置
    const snapshotIndex = versions.findIndex((v) => v.id === latestSnapshot.id);
    if (snapshotIndex === -1) {
      logger.warn(`Snapshot not found in version list for file ${fileId}`);
      return [];
    }

    const results = [];
    // https://discuss.yjs.dev/t/error-garbage-collection-must-be-disabled-in-origindoc/2313
    let currentDoc = new Y.Doc({ gc: false });
    let newDoc = new Y.Doc({ gc: false });

    // 首先应用snapshot
    if (latestSnapshot.value) {
      try {
        const snapshot = Y.decodeSnapshot(latestSnapshot.value);
        let newDoc = Y.createDocFromSnapshot(currentDoc, snapshot);
      } catch (error) {
        logger.error(`Failed to apply snapshot for file ${fileId}:`, error);
        return [];
      }
    }

    // 从snapshot之后的版本开始，应用增量更新
    for (let i = snapshotIndex + 1; i < versions.length; i++) {
      const version = versions[i];
      if (version.content_type === "update" && version.value) {
        try {
          let uo: UpdateOrigin = {
            name: "calcFileVersion",
            origin: "server",
          };
          Y.applyUpdate(newDoc, version.value, uo);
          results.push({
            versionId: version.id,
            content: Y.encodeStateAsUpdate(newDoc),
            clock: version.clock,
            createdTime: version.created_time,
          });
        } catch (error) {
          logger.error(
            `Failed to apply update for version ${version.id}:`,
            error
          );
          continue;
        }
      }
    }

    return results;
  } catch (error) {
    logger.error(
      `Failed to calculate file versions for file ${fileId}:`,
      error
    );
    throw error;
  }
};

export const calcProjectVersion = async (projectId: string) => {
  try {
    // 获取所有版本记录
    const versions = await getProjectScrollVersion(
      projectId,
      "",
      undefined,
      1000
    );
    if (!versions.items || versions.items.length === 0) {
      return [];
    }

    // 找到最近的snapshot
    const latestSnapshot = await getProjectLatestSnapshot(projectId);
    if (!latestSnapshot) {
      logger.warn(`No snapshot found for project ${projectId}`);
      return [];
    }

    // 按时间正序排序版本列表
    const sortedVersions = versions.items.sort(
      (a, b) => a.created_time.getTime() - b.created_time.getTime()
    );

    // 找到snapshot在版本列表中的位置
    const snapshotIndex = sortedVersions.findIndex(
      (v) => v.id === latestSnapshot.id
    );
    if (snapshotIndex === -1) {
      logger.warn(
        `Snapshot not found in version list for project ${projectId}`
      );
      return [];
    }

    // 从snapshot开始，计算每个版本的内容
    const results = [];
    let currentDoc = new Y.Doc({ gc: false });
    let newDoc = new Y.Doc({ gc: false });

    // 首先应用snapshot
    if (latestSnapshot.value) {
      try {
        const snapshot = Y.decodeSnapshot(latestSnapshot.value);
        newDoc = Y.createDocFromSnapshot(currentDoc, snapshot);
      } catch (error) {
        logger.error(
          `Failed to apply snapshot for project ${projectId}:`,
          error
        );
        return [];
      }
    }

    // 从snapshot之后的版本开始，应用增量更新
    for (let i = snapshotIndex + 1; i < sortedVersions.length; i++) {
      const version = sortedVersions[i];
      if (version.content_type === "update" && version.value) {
        try {
          let uo: UpdateOrigin = {
            name: "calcProjectVersion",
            origin: "server",
          };
          Y.applyUpdate(newDoc, version.value, uo);
          results.push({
            versionId: version.id,
            content: Y.encodeStateAsUpdate(newDoc),
            clock: version.clock,
            createdTime: version.created_time,
          });
        } catch (error) {
          logger.error(
            `Failed to apply update for version ${version.id}:`,
            error
          );
          continue;
        }
      }
    }

    return results;
  } catch (error) {
    logger.error(
      `Failed to calculate project versions for project ${projectId}:`,
      error
    );
    throw error;
  }
};

export const getProjectLatestSnapshot = async (
  projectId: string
): Promise<ProjectScrollVersionAttributes | null> => {
  try {
    const snapshot = await ProjectScrollVersion.findOne({
      where: {
        project_id: projectId,
        content_type: "snapshot",
      },
      order: [["created_time", "DESC"]],
    });
    return snapshot ? snapshot.get({ plain: true }) : null;
  } catch (error) {
    logger.error("Failed to get project latest snapshot:", error);
    throw error;
  }
};

export const getFileLatestSnapshot = async (
  fileId: string
): Promise<ProjectScrollVersionAttributes | null> => {
  try {
    const snapshot = await ProjectScrollVersion.findOne({
      where: {
        doc_name: fileId,
        content_type: "snapshot",
      },
      order: [["created_time", "DESC"]],
    });
    return snapshot ? snapshot.get({ plain: true }) : null;
  } catch (error) {
    logger.error("Failed to get project latest snapshot:", error);
    throw error;
  }
};
