import http from "http";
import { randomUUID } from "crypto";
import log4js from "log4js";
import { TEX_SERVICE_BASE_URL } from "./texhub_endpoint.js";

var logger = log4js.getLogger();

/**
 * 协作权限查询结果，字段与 texhub-server 的 `CollarPermissionResp` 对齐。
 * role_id: 1=Owner, 2=Collaborator, 0=非成员
 */
export interface CollarPermission {
  project_id: string;
  user_id: number;
  role_id: number;
  is_member: boolean;
  can_write: boolean;
}

/**
 * 权限结果缓存 TTL。
 *
 * 取 30s 而不是文件元数据那套 60s：把用户移出协作者后，最长 30s 内其既有
 * WebSocket 仍可写入，这个窗口是「移除协作者」这一操作的固有收敛延迟。
 */
const PERMISSION_CACHE_TTL_MS = 30 * 1000;

/**
 * 鉴权链路上的请求超时。文件元数据那种「查不到就等着」的调用可以慢慢重试，
 * 但建连鉴权不能无限期挂住，否则攻击者可以用慢请求拖住连接。
 */
const PERMISSION_REQUEST_TIMEOUT_MS = 5 * 1000;

interface PermissionCacheEntry {
  permission: CollarPermission;
  fetchedAt: number;
}

const permissionCache = new Map<string, PermissionCacheEntry>();

/** 仅供测试与手动刷新使用。 */
export const clearPermissionCache = (): void => {
  permissionCache.clear();
};

const buildCacheKey = (userId: number, projectId: string): string =>
  `${userId}:${projectId}`;

/**
 * 查询用户在某项目上的协作权限。
 *
 * 身份由转发给 texhub-server 的 `Authorization: Bearer <用户 token>` 决定，
 * 后端自行验签后取 userId，因此本方法不传 user_id —— 否则一个被攻破的
 * broadcast 就能以任意用户身份探测任意项目的成员名单。
 *
 * 任何非预期结果（网络错误、超时、非 2xx、resultCode 非 200、result 缺失）
 * 一律 reject，绝不返回「默认有权限」。调用方必须把 reject 视为拒绝连接。
 */
export const fetchCollarPermission = async (
  token: string,
  projectId: string
): Promise<CollarPermission> => {
  if (!token) {
    throw new Error("missing access token for permission lookup");
  }
  if (!projectId) {
    throw new Error("missing projectId for permission lookup");
  }
  const url = `${TEX_SERVICE_BASE_URL}/tex/share/permission?project_id=${encodeURIComponent(
    projectId
  )}`;

  return new Promise<CollarPermission>((resolve, reject) => {
    const request = http.request(
      url,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "x-request-id": randomUUID(),
        },
      },
      (response) => {
        let data = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          data += chunk;
        });
        response.on("end", () => {
          const statusCode = response.statusCode || 0;
          if (statusCode < 200 || statusCode >= 300) {
            reject(
              new Error(
                `permission lookup http status ${statusCode}, project=${projectId}`
              )
            );
            return;
          }
          let body: any;
          try {
            body = JSON.parse(data);
          } catch (e) {
            reject(
              new Error(
                `permission lookup parse failed, project=${projectId}, body=${data.slice(0, 200)}`
              )
            );
            return;
          }
          // rust_wheel 的 box_error_actix_rest_response 同样返回 HTTP 200，
          // 失败信息只体现在 resultCode 上，所以必须显式校验。
          if (!body || body.resultCode !== "200") {
            reject(
              new Error(
                `permission lookup rejected by texhub-server, project=${projectId}, resultCode=${body?.resultCode}, msg=${body?.msg}`
              )
            );
            return;
          }
          const permission: CollarPermission = body.result;
          if (
            !permission ||
            typeof permission.is_member !== "boolean" ||
            typeof permission.user_id !== "number" ||
            permission.project_id !== projectId
          ) {
            reject(
              new Error(
                `permission lookup returned malformed result, project=${projectId}`
              )
            );
            return;
          }
          resolve(permission);
        });
      }
    );

    request.setTimeout(PERMISSION_REQUEST_TIMEOUT_MS, () => {
      request.destroy(
        new Error(
          `permission lookup timeout after ${PERMISSION_REQUEST_TIMEOUT_MS}ms, project=${projectId}`
        )
      );
    });

    request.on("error", (error) => {
      reject(error);
    });

    request.end();
  });
};

/**
 * 取得用户在某项目上的协作权限（带短 TTL 缓存）。
 *
 * 只缓存成功返回的结果：失败不入缓存，避免一次后端抖动把「拒绝」固化成
 * 30 秒的拒绝风暴，也避免把偶发错误变成长期误拒。
 */
export const getProjectPermission = async (
  token: string,
  userId: number,
  projectId: string
): Promise<CollarPermission> => {
  const cacheKey = buildCacheKey(userId, projectId);
  const cached = permissionCache.get(cacheKey);
  if (cached) {
    if (Date.now() - cached.fetchedAt <= PERMISSION_CACHE_TTL_MS) {
      return cached.permission;
    }
    permissionCache.delete(cacheKey);
  }

  const permission = await fetchCollarPermission(token, projectId);

  // 后端以 token 身份判定，这里再对一次 projectId，确保调用方没有拿
  // 「A 项目的权限」去放行「B 项目」。
  if (permission.project_id !== projectId) {
    throw new Error(
      `permission response project mismatch, expected=${projectId}, got=${permission.project_id}`
    );
  }
  if (permission.user_id !== userId) {
    logger.error(
      `[collar-perm] identity mismatch, expected=${userId}, got=${permission.user_id}, project=${projectId}`
    );
    throw new Error("permission response identity mismatch");
  }

  permissionCache.set(cacheKey, { permission, fetchedAt: Date.now() });
  return permission;
};

/** 判断用户是否为项目成员（带短 TTL 缓存）。 */
export const isProjectMember = async (
  token: string,
  userId: number,
  projectId: string
): Promise<boolean> => {
  const permission = await getProjectPermission(token, userId, projectId);
  return permission.is_member;
};
