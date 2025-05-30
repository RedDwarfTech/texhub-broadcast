const persistenceDir = process.env.YPERSISTENCE;
import express, { Request, Response, Router } from "express";
import { initTpl } from "@collar/yjs_utils.js";
import { calcProjectVersion, getProjectScrollVersion } from "@/service/version_service.js";
import { ScrollQueryResult } from "@/common/types/scroll_query.js";
import { ProjectScrollVersion } from "@/model/texhub/project_scroll_version.js";
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
  const projId = req.params.projId;
  let versions = await calcProjectVersion(projId);
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
