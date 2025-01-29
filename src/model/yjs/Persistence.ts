// @ts-ignore
import * as Y from "yjs";
// @ts-ignore
import { LeveldbPersistence } from "y-leveldb";

export type Persistence = {
  provider: LeveldbPersistence;
  bindState:  (docName: string, ydoc: Y.Doc) => Promise<void>;
  writeState: (docName: string, ydoc: Y.Doc) => Promise<void>;
}