/**
 * texhub-server 内网服务地址。
 *
 * 单独抽出常量，避免文件元数据接口与协作鉴权接口指向不同后端 —— 一旦漂移，
 * 鉴权就会拿 A 服务的成员关系去放行 B 服务的项目。
 */
export const TEX_SERVICE_BASE_URL =
  process.env.TEX_SERVICE_BASE_URL ||
  "http://tex-service.reddwarf-pro.svc.cluster.local:8000";
