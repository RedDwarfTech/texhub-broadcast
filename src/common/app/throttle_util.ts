import { SyncFileAttr } from "@/model/texhub/sync_file_attr.js";
import { pgHistoryDb } from "@/storage/feat/version/doc_history.js";
import logger from "@/common/log4js_config.js";
import _ from "lodash";
//@ts-ignore
import * as Y from "yjs";

const historyDocsThrottlePool = new Map<string, ReturnType<typeof _.throttle>>();

export const getHistoryDocsThrottledFn = (docIntId: string) => {
  if (!historyDocsThrottlePool.has(docIntId)) {
    historyDocsThrottlePool.set(docIntId, _.throttle(
      async (syncFileAttr: SyncFileAttr, ydoc: Y.Doc) => {
        await pgHistoryDb.storeHistorySnapshot(syncFileAttr, ydoc);
      },
      6000,
      { leading: false, trailing: true }
    ));
  }
  return historyDocsThrottlePool.get(docIntId)!;
};

const historyDocSnapshotPool = new Map<string, Map<string, { syncFileAttr: SyncFileAttr; ydoc: Y.Doc }>>();

export const recordHistoryDocSnapshot = (syncFileAttr: SyncFileAttr, ydoc: Y.Doc) => {
  const projectId = syncFileAttr.projectId;
  let projectFiles = historyDocSnapshotPool.get(projectId);
  if (!projectFiles) {
    projectFiles = new Map<string, { syncFileAttr: SyncFileAttr; ydoc: Y.Doc }>();
    historyDocSnapshotPool.set(projectId, projectFiles);
  }
  projectFiles.set(syncFileAttr.docIntId!, { syncFileAttr, ydoc });
};

const flushSingleHistoryDoc = async (projectId: string, fileId: string) => {
  const throttledSave = historyDocsThrottlePool.get(fileId);
  const result = throttledSave?.flush();
  if (!result) return;
  await result;
};

export const flushHistoryDoc = async (projectId: string, fileIds?: string[]): Promise<boolean> => {
  let targets: string[];
  if (fileIds && fileIds.length > 0) {
    targets = fileIds;
  } else {
    const projectFiles = historyDocSnapshotPool.get(projectId);
    targets = projectFiles ? Array.from(projectFiles.keys()) : [];
  }
  const results = await Promise.allSettled(
    targets.map((fileId) => flushSingleHistoryDoc(projectId, fileId))
  );
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      logger.error(
        `flush history snapshot failed, fileId: ${targets[index]}`,
        result.reason
      );
    }
  }
  return results.every((r) => r.status === "fulfilled");
};

export const cleanupHistoryDocForProject = async (projectId: string) => {
  const projectFiles = historyDocSnapshotPool.get(projectId);
  if (!projectFiles) return;
  await flushHistoryDoc(projectId);
  for (const fileId of projectFiles.keys()) {
    historyDocsThrottlePool.delete(fileId);
  }
  historyDocSnapshotPool.delete(projectId);
};
