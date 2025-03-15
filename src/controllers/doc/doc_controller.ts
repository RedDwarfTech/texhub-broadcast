const persistenceDir = process.env.YPERSISTENCE;
import express, { Request, Response, Router } from "express";
import { initTpl } from "../../collar/yjs_utils.js";
export const routerDoc: Router = express.Router();

routerDoc.get("/", async (req: Request, res: Response) => {
  const docId = req.params.docId;
  const LeveldbPersistence = require("y-leveldb").LeveldbPersistence;
  const ldb = new LeveldbPersistence(persistenceDir);
  const persistedYdoc = await ldb.getYDoc(docId);
  let text = persistedYdoc.getText(docId);
  res.send(text);
});

/**
 * https://discuss.yjs.dev/t/is-it-possible-to-using-http-to-do-some-initial-job/2108/1
 */
routerDoc.post("/initial", async (req, res) => {
  const docId = req.body.doc_id;
  const projectId = req.body.project_id;
  const fileContent = req.body.file_content;
  initTpl(docId, projectId, fileContent);
  res.end("success");
});