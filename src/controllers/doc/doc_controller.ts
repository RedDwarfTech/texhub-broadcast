const persistenceDir = process.env.YPERSISTENCE;
import express, { Request, Response, Router } from "express";
import { initTpl } from "@collar/yjs_utils.js";
import { calcFileVersion, calcProjectVersion, getProjectScrollVersion, getProjectVersionDetail } from "@/service/version_service.js";
import logger from "@/common/log4js_config.js";
import { AppResponse } from "@/texhub/biz/AppResponse.js";
import { ProjectScrollVersionAttributes } from "@/model/texhub/project_scroll_version";

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
  const offset = req.query.offset;
  const pageSize = req.query.pageSize;
  let versions = await getProjectScrollVersion(projId!.toString(), offset!.toString(), parseInt(pageSize?.toString()!));
  res.send(versions);
});

routerDoc.get("/version/proj/scroll/detail", async (req: Request, res: Response) => {
  const id = req.query.id;
  let version = await getProjectVersionDetail(id!.toString());
  let response: AppResponse<ProjectScrollVersionAttributes> = {
    result: version,
    message: "success",
    code: 200,
  };
  res.send(response);
});

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
