import * as log4js from "log4js";
var logger = log4js.getLogger();
import lodash from "lodash";
import path from "path";
import fs from "fs";
// @ts-ignore
import * as Y from "rdyjs";
import { updateFullsearch } from "./fulltext.js";
import { getFileJsonData } from "../texhub/client/texhub_interop.js";
import { FileContent } from "../model/texhub/file_content.js";
import { AppResponse } from "../texhub/biz/AppResponse.js";
import { PostgresqlPersistance } from "./adapter/postgresql/postgresql_persistance.js";

export const throttledFn = lodash.throttle(
  (docName: string, ldb: PostgresqlPersistance) => {
    handleFileSync(docName, ldb);
  },
  2000
);

const handleFileSync = async (docName: string, ldb: PostgresqlPersistance) => {
  try {
    /**
     * https://discuss.yjs.dev/t/how-to-get-the-document-text-the-decode-content-not-binary-content-in-y-websocket/2033/1
     */
    const persistedYdoc: Y.Doc = await ldb.getYDoc(docName);
    let text: Y.Text = persistedYdoc.getText(docName);
    if (text == null) {
      logger.error("text is null");
      return;
    }
    if (text == undefined) {
      logger.error("text is undefined");
      return;
    }
    let fileInfo: FileContent = await getTexFileInfo(docName);
    if (!fileInfo || !fileInfo.file_path) {
      logger.warn(
        "fileInfo is null or fileInfo.file_path is null" +
          JSON.stringify(fileInfo)
      );
      return;
    }
    let textContext = text.toString();
    let projectId = fileInfo.project_id;
    let fileName = fileInfo.name;
    let filePath = fileInfo.file_path;
    let date = new Date(fileInfo.project_created_time);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    let folderPath = path.join(
      `/opt/data/project/${year}/${month}/${projectId}`,
      filePath
    );
    fs.mkdir(folderPath, { recursive: true }, (error) => {
      if (error) {
        logger.error("craete directory failed,", error);
      }
    });
    fs.writeFile(path.join(folderPath, fileName), textContext, (err) => {
      if (err) {
        logger.error("Failed to write file:", err);
      }
    });
    let ct = fileInfo.created_time;
    let ut = fileInfo.updated_time;
    let fid = fileInfo.file_id;
    let file = {
      name: fileName,
      created_time: ct,
      updated_time: ut,
      content: text.toString(),
      project_id: projectId,
      file_id: fid,
      file_path: filePath,
    };
    updateFullsearch(file);
  } catch (err) {
    logger.error("Failed to sync file to disk", err);
  }
};

export const getTexFileInfo = async (docName: string): Promise<FileContent> => {
  let fileContent: AppResponse<FileContent> = await getFileJsonData(docName);
  if (!fileContent) {
    logger.error(
      `get file info failed，file info: ${fileContent},docName:${docName}`
    );
  }
  return fileContent.result;
};
