const persistenceDir = process.env.YPERSISTENCE;
import express, { Request, Response, Router } from "express";
import { initTpl } from "@collar/yjs_utils.js";
import { calcFileVersion, calcProjectVersion } from "@/service/version_service.js";
import logger from "@/common/log4js_config.js";
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

routerDoc.get("/version/file/scroll", async (req: Request, res: Response) => {
  const fileId = req.query.fileId as string;
  if (!fileId) {
    return res.status(400).json({ error: 'fileId is required' });
  }
  try {
    let versions = await calcFileVersion(fileId);
    res.send(versions);
  } catch (error) {
    logger.error(`Failed to get file versions for fileId ${fileId}:`, error);
    res.status(500).json({ error: 'Failed to get file versions' });
  }
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
