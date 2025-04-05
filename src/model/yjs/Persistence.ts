import { PostgresqlPersistance } from "@storage/adapter/postgresql/postgresql_persistance";
import * as Y from "yjs";

export type Persistence = {
  provider: PostgresqlPersistance;
  bindState:  (docName: string, ydoc: Y.Doc) => Promise<void>;
  writeState: (docName: string, ydoc: Y.Doc) => Promise<void>;
}