import http from "http";
import { randomUUID } from "crypto";
import log4js from "log4js";
import { FileContent } from "@model/texhub/file_content";
import { AppResponse } from "../biz/AppResponse";
var logger = log4js.getLogger();

const generateRequestId = (): string => {
  return randomUUID();
};

/**
 * 文件详情缓存：按 file_id 缓存 infra/tex 返回的文件元数据。
 * 文件元数据（file_path/project_id/name 等）在创建后基本不变，
 * flush 每次写盘前无需重复查询 texhub-server，用 60s TTL 显著降低请求压力。
 */
interface FileInfoCacheEntry {
  data: AppResponse<FileContent>;
  fetchedAt: number;
}

const FILE_INFO_CACHE_TTL_MS = 60 * 1000;
const fileInfoCache = new Map<string, FileInfoCacheEntry>();

const getCachedFileInfo = (fileId: string): AppResponse<FileContent> | undefined => {
  const entry = fileInfoCache.get(fileId);
  if (!entry) {
    return undefined;
  }
  if (Date.now() - entry.fetchedAt > FILE_INFO_CACHE_TTL_MS) {
    fileInfoCache.delete(fileId);
    return undefined;
  }
  return entry.data;
};

const setCachedFileInfo = (fileId: string, data: AppResponse<FileContent>): void => {
  fileInfoCache.set(fileId, { data, fetchedAt: Date.now() });
};

const flushIndex = (fileId: string, content: string) => {
  const baseUrl = "http://tex-service.reddwarf-pro.svc.cluster.local:8000";
  const url = `${baseUrl}/tex/project/flush/idx`;
  let req = {
    file_id: fileId,
    content: content,
  };
  const requestData = JSON.stringify(req);
  const options = {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(requestData),
      "x-request-id": generateRequestId(),
    },
  };
  const request = http.request(url, options, (response) => {
    let body = "";
    response.setEncoding("utf8");
    response.on("data", (chunk) => {
      body += chunk;
    });
    response.on("end", () => {
      logger.warn("request response: " + body);
    });
  });
  request.on("error", (error) => {
    logger.error("send idx file info error" + error);
  });
  request.write(requestData);
  request.end();
};

export const getFileJsonData = async (
  fileId: string
): Promise<AppResponse<FileContent>> => {
  const cached = getCachedFileInfo(fileId);
  if (cached) {
    return cached;
  }

  return new Promise((resolve, reject) => {
    const baseUrl = "http://tex-service.reddwarf-pro.svc.cluster.local:8000";
    const url = `${baseUrl}/tex/file/y-websocket/detail?file_id=${encodeURIComponent(
      fileId
    )}`;
    const request = http.request(
      url,
      {
        method: "GET",
        headers: {
          "x-request-id": generateRequestId(),
        },
      },
      (response) => {
        let data = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          data += chunk;
        });
        response.on("end", () => {
          try {
            const json: AppResponse<FileContent> = JSON.parse(data);
            setCachedFileInfo(fileId, json);
            resolve(json);
          } catch (e) {
            logger.error("parse json failed" + e + ",data:" + data + ",url:" + url);
            reject(e);
          }
        });
      }
    );
    request.on("error", (error) => {
      logger.error("get file info error" + error);
      reject(error);
    });
    request.end();
  });
};