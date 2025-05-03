import http from "http";
import * as log4js from "log4js";
import { FileContent } from "@model/texhub/file_content";
import { AppResponse } from "../biz/AppResponse";
var logger = log4js.getLogger();

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

export const getFileJsonData = (
  fileId: string
): Promise<AppResponse<FileContent>> => {
  return new Promise((resolve, reject) => {
    const baseUrl = "http://tex-service.reddwarf-pro.svc.cluster.local:8000";
    const url = `${baseUrl}/tex/file/y-websocket/detail?file_id=${encodeURIComponent(
      fileId
    )}`;
    http
      .get(url, (response) => {
        let data = "";
        response.on("data", (chunk) => {
          data += chunk;
        });
        response.on("end", () => {
          try {
            const json: AppResponse<FileContent> = JSON.parse(data);
            resolve(json);
          } catch (e) {
            logger.error("parse json failed" + e + ",data:" + data);
          }
        });
      })
      .on("promise error", (error) => {
        logger.error("get file info error" + error);
        reject(error);
      });
  });
};
