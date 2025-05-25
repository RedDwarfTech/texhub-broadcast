import { PostgresqlPersistance } from "@storage/adapter/postgresql/postgresql_persistance";
import * as Y from "rdyjs";
import { SyncFileAttr } from "../texhub/sync_file_attr";

export type Persistence = {
  provider: PostgresqlPersistance;
  bindState:  (syncFileAttr: SyncFileAttr, ydoc: Y.Doc) => Promise<void>;
  writeState: (docName: string, ydoc: Y.Doc) => Promise<void>;
}