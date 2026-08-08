const persistenceDir = process.env.YPERSISTENCE;
import express, { Request, Response, Router } from "express";
import { initTpl } from "@collar/yjs_utils.js";
import {
  calcFileVersion,
  calcProjectVersion,
  getProjectScrollVersion,
  getProjectVersionDetail,
} from "@/service/version_service.js";
import logger from "@/common/log4js_config.js";
import { AppResponse } from "@/texhub/biz/AppResponse.js";
import { ProjectScrollVersionAttributes } from "@/model/texhub/project_scroll_version";
import { queryFullDeletions } from "@/storage/handler/deletion_audit.js";
import { flushProjectToDisk } from "@/storage/appfile.js";
import { flushHistoryDoc } from "@/common/app/throttle_util.js";
import { postgresqlDb } from "@/storage/storage.js";
import { MAX_I64 } from "@/common/app/global_constant.js";

export const routerDoc: Router = express.Router();

routerDoc.get("/", async (req: Request, res: Response) => {
  const docId = req.params.docId;
  const LeveldbPersistence = require("y-leveldb").LeveldbPersistence;
  const ldb = new LeveldbPersistence(persistenceDir);
  const persistedYdoc = await ldb.getYDoc(docId);
  let text = persistedYdoc.getText(docId);
  res.send(text);
});

routerDoc.get("/version/proj/scroll", async (req: Request, res: Response) => {
  const projId = req.query.projId;
  const fileId = req.query.fileId?.toString() || "";
  const offset = req.query.offset
    ? req.query.offset?.toString()!
    : MAX_I64.toString();
  const pageSize = req.query.pageSize
    ? parseInt(req.query.pageSize?.toString()!)
    : 10;
  let versions = await getProjectScrollVersion(
    projId!.toString(),
    fileId,
    offset,
    pageSize
  );
  res.send(versions);
});

routerDoc.get(
  "/version/proj/scroll/detail",
  async (req: Request, res: Response) => {
    const id = req.query.id;
    let version = await getProjectVersionDetail(id!.toString());
    let response: AppResponse<ProjectScrollVersionAttributes> = {
      result: version,
      message: "success",
      code: 200,
    };
    res.send(response);
  }
);

routerDoc.get("/version/file/scroll", async (req: Request, res: Response) => {
  const fileId = req.query.fileId;
  let versions = await calcFileVersion(fileId!.toString());
  res.send(versions);
});

/**
 * https://discuss.yjs.dev/t/is-it-possible-to-using-http-to-do-some-initial-job/2108/1
 */
routerDoc.post("/initial", async (req: Request, res: Response) => {
  const docId = req.body.doc_id;
  const projectId = req.body.project_id;
  const fileContent = req.body.file_content;
  await initTpl(docId, projectId, fileContent);
  res.end("success");
});

/**
 * 编译前强制 flush 接口（由 texhub-server 调用）。
 * body: { project_id: string, file_ids: string[] }
 * 返回每个文件 flush 的结果。
 */
routerDoc.post("/flush/project", async (req: Request, res: Response) => {
  const projectId = (req.body?.project_id || "").toString();
  const fileIds: string[] = Array.isArray(req.body?.file_ids)
    ? req.body.file_ids.map((id: any) => String(id))
    : [];
  if (!projectId) {
    const response: AppResponse<any> = {
      result: null,
      message: "project_id is required",
      code: 400,
    };
    res.status(400).json(response);
    return;
  }
  try {
    const result = await flushProjectToDisk(projectId, fileIds, postgresqlDb);
    const response: AppResponse<any> = {
      result,
      message: "success",
      code: 200,
    };
    res.json(response);
  } catch (error) {
    logger.error("flush project failed", error);
    const response: AppResponse<any> = {
      result: null,
      message: "flush project failed",
      code: 500,
    };
    res.status(500).json(response);
  }
});

/**
 * 查看历史版本前强制刷新历史快照接口（由 texhub-server 调用）。
 * body: { project_id: string, file_ids?: string[] }
 * file_ids 省略时刷新该项目下所有处于节流挂起状态的文件。
 * 返回成功或失败。
 */
routerDoc.post("/flush/history", async (req: Request, res: Response) => {
  const projectId = (req.body?.project_id || "").toString();
  const fileIds: string[] = Array.isArray(req.body?.file_ids)
    ? req.body.file_ids.map((id: any) => String(id))
    : [];
  if (!projectId) {
    const response: AppResponse<any> = {
      result: null,
      message: "project_id is required",
      code: 400,
    };
    res.status(400).json(response);
    return;
  }
  logger.info("[history] /doc/flush/history called", {
    projectId,
    fileIds,
    time: new Date().toISOString(),
  });
  try {
    const result = await flushHistoryDoc(
      projectId,
      fileIds.length > 0 ? fileIds : undefined
    );
    const response: AppResponse<any> = {
      result,
      message: result ? "success" : "flush project history failed",
      code: result ? 200 : 500,
    };
    res.status(result ? 200 : 500).json(response);
  } catch (error) {
    logger.error("flush project history failed", error);
    const response: AppResponse<any> = {
      result: false,
      message: "flush project history failed",
      code: 500,
    };
    res.status(500).json(response);
  }
});

/**
 * 查询文档的完全删除记录
 */
routerDoc.get("/audit/full-deletions", async (req: Request, res: Response) => {
  try {
    const docName = req.query.docName as string;
    const days = req.query.days ? parseInt(req.query.days as string) : 7;

    const deletions = await queryFullDeletions(docName, days);

    const response: AppResponse<any> = {
      result: {
        deletions,
        total: deletions.length,
        docName: docName || "all",
        days
      },
      message: "success",
      code: 200,
    };
    res.json(response);
  } catch (error) {
    logger.error("Failed to query full deletions", error);
    const response: AppResponse<any> = {
      result: null,
      message: "Failed to query full deletions",
      code: 500,
    };
    res.status(500).json(response);
  }
});
