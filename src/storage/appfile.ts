import log4js from "log4js";
var logger = log4js.getLogger();
import lodash, { ThrottleSettings } from "lodash";
import path from "path";
import fs from "fs";
// @ts-ignore
import * as Y from "yjs";
import { updateFullsearch } from "./fulltext.js";
import { getFileJsonData } from "../texhub/client/texhub_interop.js";
import { FileContent } from "../model/texhub/file_content.js";
import { AppResponse } from "../texhub/biz/AppResponse.js";
import { PostgresqlPersistance } from "./adapter/postgresql/postgresql_persistance.js";
import { SyncFileAttr } from "@/model/texhub/sync_file_attr.js";
import { TeXFileType } from "@/model/enum/tex_file_type.js";

let options: ThrottleSettings = {
  trailing: true,
  leading: false,
};

export const throttledFn = lodash.throttle(
  (syncFileAttr: SyncFileAttr, ldb: PostgresqlPersistance) => {
    if (syncFileAttr.docType === TeXFileType.PROJECT) {
      return;
    }
    flushFileToDiskAndSearchEngine(syncFileAttr, ldb);
  },
  2000,
  options,
);

export const flushFileToDiskAndSearchEngine = async (
  syncFileAttr: SyncFileAttr,
  ldb: PostgresqlPersistance,
  throwOnError: boolean = false,
) => {
  try {
    /**
     * https://discuss.yjs.dev/t/how-to-get-the-document-text-the-decode-content-not-binary-content-in-y-websocket/2033/1
     */
    let docName = syncFileAttr.docName;
    const persistedYdoc: Y.Doc = await ldb.getYDoc(syncFileAttr);
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
          JSON.stringify(fileInfo) +
          "," +
          JSON.stringify(syncFileAttr),
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
      filePath,
    );
    await fs.promises.mkdir(folderPath, { recursive: true });
    await fs.promises.writeFile(path.join(folderPath, fileName), textContext);
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
    if (throwOnError) {
      throw err;
    }
  }
};

export const getTexFileInfo = async (docName: string): Promise<FileContent> => {
  let fileContent: AppResponse<FileContent> = await getFileJsonData(docName);
  if (!fileContent) {
    logger.error(
      `get file info failed，file info: ${fileContent},docName:${docName}`,
    );
  }
  return fileContent.result;
};

export interface FlushProjectResult {
  projectId: string;
  flushed: string[];
  skipped: string[];
  failed: { fileId: string; error: string }[];
}

/**
 * 编译前强制 flush：等待每个文档的更新落库稳定后，把最新文本写盘。
 * 保证 texhub-server 在入队编译前，磁盘上是点击编译时刻的最新内容。
 */
export const flushProjectToDisk = async (
  projectId: string,
  fileIds: string[],
  ldb: PostgresqlPersistance,
): Promise<FlushProjectResult> => {
  const result: FlushProjectResult = {
    projectId,
    flushed: [],
    skipped: [],
    failed: [],
  };
  for (const fileId of fileIds) {
    const syncFileAttr: SyncFileAttr = {
      docName: fileId,
      docType: TeXFileType.TEX,
      projectId,
      docIntId: "",
      docShowName: "flush-before-compile",
      src: "flush-project",
    };
    try {
      const hasUpdates = await ldb.waitDocUpdateStable(fileId);
      if (!hasUpdates) {
        result.skipped.push(fileId);
        continue;
      }
      await flushFileToDiskAndSearchEngine(syncFileAttr, ldb, true);
      result.flushed.push(fileId);
    } catch (err) {
      logger.error(`flush file to disk failed, fileId: ${fileId}`, err);
      result.failed.push({ fileId, error: String(err) });
    }
  }
  return result;
};
