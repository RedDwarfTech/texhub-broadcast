import { Socket } from "socket.io";
import logger from "@common/log4js_config.js";
import { TeXFileType } from "@model/enum/tex_file_type.js";
import { SyncFileAttr } from "@model/texhub/sync_file_attr.js";
import { getTexFileInfo } from "@storage/appfile.js";
import { getProjectPermission } from "@/texhub/client/collar_permission_client.js";

/** 鉴权拒绝的原因码，落到 socket.data 便于日志与客户端提示。 */
export const ACCESS_DENIED_REASON = {  NOT_AUTHENTICATED: "not_authenticated",
  UNSUPPORTED_DOC_TYPE: "unsupported_doc_type",
  PROJECT_UNRESOLVED: "project_unresolved",
  PERMISSION_CHECK_FAILED: "permission_check_failed",
  NOT_A_MEMBER: "not_a_member",
  FILE_OUT_OF_PROJECT: "file_out_of_project",
  NO_ACCESS_SCOPE: "no_access_scope",
} as const;

/**
 * 一条连接被授权的访问范围。
 *
 * 关键点：`projectId` 是服务端从权威来源解析出来的，**不是**客户端 query 里
 * 传来的 projId。subdoc / SwitchEditFile 的归属校验都以这个值为准。
 */
export interface ConnectionAccessScope {
  userId: number;
  projectId: string;
  docId: string;
  docType: number;
  canWrite: boolean;
}

export class AccessDeniedError extends Error {
  public readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.name = "AccessDeniedError";
    this.reason = reason;
  }
}

const getSocketUser = (socket: Socket): { userId: number; token: string } => {
  const data = socket.data as any;
  const userId = data?.user?.userId;
  const token = data?.accessToken;
  if (typeof userId !== "number" || !Number.isSafeInteger(userId) || !token) {
    // 说明 authMiddleware 没跑过或结构异常，一律按未认证处理
    throw new AccessDeniedError(
      ACCESS_DENIED_REASON.NOT_AUTHENTICATED,
      "socket has no verified identity"
    );
  }
  return { userId, token };
};

/**
 * 解析「客户端要打开的文档」对应的权威 projectId。
 *
 * - docType=PROJECT：根 doc 本身就是项目容器，docId 即 projectId。
 * - docType=TEX：docId 是 file_id，必须回查文件元数据拿 project_id。
 *
 * 刻意**不**使用 query 里的 projId：它完全由客户端控制，若直接采信，攻击者只要
 * 传自己的 projId + 别人的 fileId，就能用「自己项目的成员身份」通过校验后再去
 * 读别人项目的文件。
 */
const resolveProjectIdForDoc = async (
  syncFileAttr: SyncFileAttr
): Promise<string> => {
  const docId = String(syncFileAttr.docName || "");
  if (!docId) {
    throw new AccessDeniedError(
      ACCESS_DENIED_REASON.PROJECT_UNRESOLVED,
      "empty docId"
    );
  }
  if (syncFileAttr.docType === TeXFileType.PROJECT) {
    return docId;
  }
  if (syncFileAttr.docType === TeXFileType.TEX) {
    let fileInfo: Awaited<ReturnType<typeof getTexFileInfo>> | undefined;
    try {
      fileInfo = await getTexFileInfo(docId);
    } catch (e) {
      logger.error(`[ws-authz] resolve file project failed, docId=${docId}`, e);
      throw new AccessDeniedError(
        ACCESS_DENIED_REASON.PROJECT_UNRESOLVED,
        `failed to resolve project for file ${docId}`
      );
    }
    const projectId = fileInfo && fileInfo.project_id;
    if (!projectId) {
      // getTexFileInfo 失败时返回的是空壳对象，这里等价于「查不到归属」=> 拒绝
      throw new AccessDeniedError(
        ACCESS_DENIED_REASON.PROJECT_UNRESOLVED,
        `file ${docId} has no resolvable project`
      );
    }
    return String(projectId);
  }
  throw new AccessDeniedError(
    ACCESS_DENIED_REASON.UNSUPPORTED_DOC_TYPE,
    `unsupported docType ${syncFileAttr.docType}`
  );
};

/**
 * 建连鉴权：解析权威 projectId 并确认调用者是该项目成员。
 *
 * 全流程 fail-closed：任何一步失败都抛 AccessDeniedError，由调用方断开连接。
 * 返回值请存进 socket.data，作为后续 subdoc / 控制消息的唯一作用域。
 */
export const authorizeConnection = async (
  socket: Socket,
  syncFileAttr: SyncFileAttr
): Promise<ConnectionAccessScope> => {
  const { userId, token } = getSocketUser(socket);

  const projectId = await resolveProjectIdForDoc(syncFileAttr);

  let permission: Awaited<ReturnType<typeof getProjectPermission>>;
  try {
    permission = await getProjectPermission(token, userId, projectId);
  } catch (e) {
    // 权限服务不可用 / 超时 / 返回异常，一律拒绝，绝不放行
    logger.error(
      `[ws-authz] permission check failed, userId=${userId}, project=${projectId}`,
      e
    );
    throw new AccessDeniedError(
      ACCESS_DENIED_REASON.PERMISSION_CHECK_FAILED,
      "failed to verify collaboration permission"
    );
  }

  if (!permission.is_member) {
    logger.error(
      `[ws-authz] access denied, userId=${userId}, project=${projectId}, doc=${syncFileAttr.docName}, reason=not_a_member`
    );
    throw new AccessDeniedError(
      ACCESS_DENIED_REASON.NOT_A_MEMBER,
      "user is not a collaborator of this project"
    );
  }

  return {
    userId,
    projectId,
    docId: String(syncFileAttr.docName),
    docType: syncFileAttr.docType,
    // 取后端判定结果而非写死 true：当前数据模型里 Owner 与 Collaborator
    // 均可写，canWrite 因此恒为 true，但它必须来自后端，否则将来加只读角色时
    // 这里会静默放行。
    canWrite: permission.can_write === true,
  };
};

/** 取出连接已授权的作用域；未鉴权的连接视为无作用域。 */
export const getAccessScope = (socket: Socket): ConnectionAccessScope | null => {
  const scope = (socket.data as any)?.accessScope as
    | ConnectionAccessScope
    | undefined;
  if (!scope || !scope.projectId || !scope.docId) {
    return null;
  }
  return scope;
};

/**
 * 校验某个 file_id 是否属于该连接已授权的项目。
 *
 * 用于 subdoc GUID 与 SwitchEditFile：客户端可以随便编 file_id / GUID，
 * 必须逐个回查其真实归属再和已授权 projectId 比对，不能信任消息里的任何
 * project 字段。
 */
export const assertFileBelongsToProject = async (
  socket: Socket,
  fileId: string
): Promise<{ allowed: boolean; reason?: string }> => {
  const scope = getAccessScope(socket);
  if (!scope) {
    return { allowed: false, reason: ACCESS_DENIED_REASON.NO_ACCESS_SCOPE };
  }
  if (!fileId || fileId === scope.projectId || fileId === scope.docId) {
    // 根文档 / 项目容器本身已在建连时鉴权，无需再查
    return { allowed: true };
  }

  let projectId: string | undefined;
  try {
    const fileInfo = await getTexFileInfo(fileId);
    projectId = fileInfo && fileInfo.project_id ? String(fileInfo.project_id) : undefined;
  } catch (e) {
    logger.error(`[ws-authz] resolve subdoc project failed, fileId=${fileId}`, e);
    return { allowed: false, reason: ACCESS_DENIED_REASON.PROJECT_UNRESOLVED };
  }

  if (!projectId) {
    return { allowed: false, reason: ACCESS_DENIED_REASON.PROJECT_UNRESOLVED };
  }
  if (projectId !== scope.projectId) {
    logger.error(
      `[ws-authz] cross-project access denied, userId=${scope.userId}, scopeProject=${scope.projectId}, fileId=${fileId}, fileProject=${projectId}`
    );
    return { allowed: false, reason: ACCESS_DENIED_REASON.FILE_OUT_OF_PROJECT };
  }
  return { allowed: true };
};

/**
 * 断开一条未通过鉴权的连接。
 *
 * 先发 `ws:access_denied` 让客户端知道是「没有权限」而不是「网络断了」，
 * 避免它无意义地重连刷 401。`disconnect(true)` 会让客户端收到
 * `io server disconnect`，socket.io-client 不会自动重连。
 */
export const denyConnection = (socket: Socket, error: AccessDeniedError): void => {
  try {
    socket.emit("ws:access_denied", { reason: error.reason });
  } catch (e) {
    // ignore: 连接可能已不可写
  }
  try {
    socket.disconnect(true);
  } catch (e) {
    // ignore
  }
};
