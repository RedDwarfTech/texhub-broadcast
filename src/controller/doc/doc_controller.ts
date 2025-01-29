const persistenceDir = process.env.YPERSISTENCE;
export const routerDoc = express.Router();
import express, { Request, Response } from "express";
const initTpl = require("../tex/initial_tpl.js").initTpl;

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