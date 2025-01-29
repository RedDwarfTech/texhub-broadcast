import log4js from "log4js";
var logger = log4js.getLogger();
import lodash from "lodash";
import path from "path";
import fs from "fs";
import { updateFullsearch } from "./fulltext";
import { getFileJsonData } from "../texhub/client/texhub_interop";
import { FileContent } from "../model/texhub/file_content";
import { AppResponse } from "../texhub/biz/AppResponse";

export const throttledFn = lodash.throttle((docName, ldb) => {
  handleFileSync(docName, ldb);
}, 2000);

const handleFileSync = async (docName: string, ldb: any) => {
  try {
    /**
     * https://discuss.yjs.dev/t/how-to-get-the-document-text-the-decode-content-not-binary-content-in-y-websocket/2033/1
     */
    const persistedYdoc = await ldb.getYDoc(docName);
    let text = persistedYdoc.getText(docName);
    if (!text || !text.toString()) {
      return;
    }
    let fileContent: AppResponse<FileContent> = await getFileJsonData(docName);
    if (!fileContent) {
      logger.error(
        `get file info failed，file info: ${fileContent},docName:${docName}`
      );
      return;
    }
    let projectId = fileContent.result.project_id;
    let fileName = fileContent.result.name;
    let filePath = fileContent.result.file_path;
    let date = new Date(fileContent.result.project_created_time);
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
    fs.writeFile(path.join(folderPath, fileName), text.toString(), (err) => {
      if (err) {
        logger.error("Failed to write file:", err);
      }
    });
    let ct = fileContent.result.created_time;
    let ut = fileContent.result.updated_time;
    let fid = fileContent.result.file_id;
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
