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
import {
  getDiskFlushPendingDoc,
  getDiskFlushPendingFile,
  getDiskFlushPendingFileIds,
  clearDiskFlushPending,
  removeDiskFlushPending,
} from "@/common/app/throttle_util.js";

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

/**
 * Write file to disk and update full-text search from a live Y.Doc.
 * This avoids the expensive DB reconstruction (getYDoc) when the in-memory
 * Y.Doc is already up-to-date.
 */
export const flushFileToDiskFromDoc = async (
  syncFileAttr: SyncFileAttr,
  ydoc: Y.Doc,
  throwOnError: boolean = false,
) => {
  try {
    const docName = syncFileAttr.docName;
    const text: Y.Text = ydoc.getText(docName);
    if (text == null || text == undefined) {
      logger.error("[disk-flush] text is null or undefined", { docName });
      return;
    }
    const fileInfo: FileContent = await getTexFileInfo(docName);
    if (!fileInfo || !fileInfo.file_path) {
      logger.warn("[disk-flush] fileInfo is null or missing file_path", {
        docName,
        fileInfo: JSON.stringify(fileInfo),
      });
      return;
    }
    const textContext = text.toString();
    const projectId = fileInfo.project_id;
    const fileName = fileInfo.name;
    const filePath = fileInfo.file_path;
    const date = new Date(fileInfo.project_created_time);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const folderPath = path.join(
      `/opt/data/project/${year}/${month}/${projectId}`,
      filePath,
    );
    await fs.promises.mkdir(folderPath, { recursive: true });
    await fs.promises.writeFile(path.join(folderPath, fileName), textContext);
    const file = {
      name: fileName,
      created_time: fileInfo.created_time,
      updated_time: fileInfo.updated_time,
      content: textContext,
      project_id: projectId,
      file_id: fileInfo.file_id,
      file_path: filePath,
    };
    updateFullsearch(file);
  } catch (err) {
    logger.error("[disk-flush] Failed to flush file from live doc", err);
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
 * 编译前强制 flush：由本服务自行决定哪些文件需要落盘。
 * 目标文件 = 本实例内存挂起池 ∪ Redis 挂起标记（跨实例）。
 * 优先使用内存中的活 Y.Doc 直接写盘（O(1) 操作），
 * 仅对内存中没有的文件（跨实例编辑）fallback 到 PostgreSQL 重建。
 * 一般情况下仅 flush 最近几秒编辑过的 1-N 个文件。
 */
export const flushProjectToDisk = async (
  projectId: string,
  ldb: PostgresqlPersistance,
): Promise<FlushProjectResult> => {
  const result: FlushProjectResult = {
    projectId,
    flushed: [],
    skipped: [],
    failed: [],
  };
  const targets = await getDiskFlushPendingFileIds(projectId);
  logger.info("[disk-flush] flush requested", {
    projectId,
    targetCount: targets.length,
    targets,
    time: new Date().toISOString(),
  });

  const flushOne = async (fileId: string) => {
    // Fast path: check in-memory live Y.Doc (edited in this instance)
    const inMemoryDoc = getDiskFlushPendingDoc(projectId, fileId);
    if (inMemoryDoc) {
      const syncFileAttr: SyncFileAttr = {
        docName: inMemoryDoc.syncFileAttr.docName,
        docType: TeXFileType.TEX,
        projectId,
        docIntId: fileId,
        docShowName: "flush-before-compile",
        src: "flush-project",
      };
      await flushFileToDiskFromDoc(syncFileAttr, inMemoryDoc.ydoc, true);
      removeDiskFlushPending(projectId, fileId);
      await clearDiskFlushPending(projectId, fileId);
      result.flushed.push(fileId);
      return;
    }

    // Slow path: file edited in another instance, reconstruct from DB
    const pendingFile = await getDiskFlushPendingFile(fileId);
    if (pendingFile && pendingFile.projectId === projectId) {
      const syncFileAttr: SyncFileAttr = {
        docName: pendingFile.docName,
        docType: TeXFileType.TEX,
        projectId,
        docIntId: fileId,
        docShowName: "flush-before-compile",
        src: "flush-project",
      };
      const hasUpdates = await ldb.waitDocUpdateStable(pendingFile.docName);
      if (!hasUpdates) {
        result.skipped.push(fileId);
        return;
      }
      await flushFileToDiskAndSearchEngine(syncFileAttr, ldb, true);
      await clearDiskFlushPending(projectId, fileId);
      result.flushed.push(fileId);
      return;
    }

    // No in-memory doc and no Redis marker: file is no longer dirty, skip
    result.skipped.push(fileId);
  };

  // Pending files are usually few (1-N), flush them with bounded concurrency
  const CONCURRENCY = 10;
  let index = 0;
  const workers = Array.from(
    { length: Math.min(CONCURRENCY, targets.length) },
    async () => {
      while (index < targets.length) {
        const fileId = targets[index++];
        try {
          await flushOne(fileId);
        } catch (err) {
          logger.error(`[disk-flush] flush file to disk failed, fileId: ${fileId}`, err);
          result.failed.push({ fileId, error: String(err) });
        }
      }
    },
  );
  await Promise.all(workers);
  return result;
};
