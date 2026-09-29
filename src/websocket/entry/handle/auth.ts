import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import logger from "@common/log4js_config.js";

export const WEBSOCKET_AUTH_FAILED = 4000;
export const WEBSOCKET_AUTH_TOKEN_EXPIRE = 4001;

/**
 * JWT 签名密钥。签发方（infra-server / texhub-server）使用 rust_wheel 的
 * `JWT_SECRET`（backend/rust_wheel/src/model/user/jwt_auth.rs），本服务历史上读的是
 * `JWT_SIGN_KEY`；两者任一存在即视为已配置，保证与签发方取同一份密钥。
 *
 * 绝不提供 fallback：签名密钥缺失或使用公开默认值时，任何人都能自行签发任意
 * token，鉴权形同虚设。
 */
const resolveJwtSignKey = (): string => {
  const key = process.env.JWT_SIGN_KEY || process.env.JWT_SECRET;
  if (!key) {
    throw new Error(
      "JWT signing key is not configured: set JWT_SIGN_KEY (or JWT_SECRET) to the " +
        "same value used by the token issuer, otherwise every connection would be rejected"
    );
  }
  return key;
};

const JWT_SIGN_KEY = resolveJwtSignKey();

/**
 * 凭据来源优先级：handshake.auth.token（Socket.IO CONNECT 包，不进 URL /
 * access log / Referer）> Authorization: Bearer header（原生客户端）。
 *
 * 历史上读的是 query param `access_token`，它会落进网关 access log 与浏览器历史，
 * 因此不再接受。若线上仍有旧版客户端，需先升级前端再启用本服务。
 */
const extractToken = (socket: Socket): string | null => {
  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === "string" && authToken.length > 0) {
    return authToken;
  }
  const header = socket.handshake.headers["authorization"];
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    const bearer = header.slice("Bearer ".length).trim();
    if (bearer.length > 0) {
      return bearer;
    }
  }
  return null;
};

const buildAuthError = (code: number, message: string): Error => {
  const error = new Error(message) as Error & { data?: { code: number } };
  error.data = { code };
  return error;
};

/**
 * Socket.IO 命名空间中间件。鉴权失败一律 `next(error)` 拒绝连接（fail-closed），
 * 严禁在失败分支放行。
 */
export const authMiddleware = (
  socket: Socket,
  next: (err?: Error) => void
) => {
  const token = extractToken(socket);
  if (!token) {
    logger.error(
      `[ws-auth] missing access token, socket=${socket.id}, address=${socket.handshake.address}`
    );
    return next(
      buildAuthError(WEBSOCKET_AUTH_FAILED, "auth token is missing")
    );
  }
  jwt.verify(token, JWT_SIGN_KEY, (err: any, decoded: any) => {
    if (err) {
      // 只记录错误类型，不记录 token 明文
      logger.error(
        `[ws-auth] token verification failed, name=${err?.name}, message=${err?.message}, socket=${socket.id}`
      );
      if (err?.name === "TokenExpiredError") {
        return next(
          buildAuthError(
            WEBSOCKET_AUTH_TOKEN_EXPIRE,
            "access token is expired"
          )
        );
      }
      return next(
        buildAuthError(WEBSOCKET_AUTH_FAILED, "invalid access token")
      );
    }
    socket.data.user = decoded;
    // 原始 token 单独留一份：后续 membership 校验需要把它转发给 texhub-server
    // 做验签，broadcast 自己解出的 payload 不能当作跨服务的身份凭据。
    socket.data.accessToken = token;
    next();
  });
};

/**
 * 业务连接分布在两个命名空间：编辑器走 `/texhub`（见 texhub_conn.ts），
 * 开发配置（config-dev.ts）走默认 `/`。两者都必须鉴权——历史上这里只在根
 * 命名空间注册了 `io.use()`，对 `/texhub` 完全不生效。
 */
export const registerAuthMiddleware = (websocketServer: Server) => {
  websocketServer.of("/").use(authMiddleware);
  websocketServer.of("/texhub").use(authMiddleware);
};
