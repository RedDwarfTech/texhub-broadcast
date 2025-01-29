import log4js from "log4js";
var logger = log4js.getLogger();
import { DocumentOptions, MeiliSearch } from "meilisearch";

export const updateFullsearch = async (file: any) => {
  try {
    const masterKey = process.env.MEILI_MASTER_KEY;
    let option: DocumentOptions = {
      primaryKey: "file_id",
    };
    const client = new MeiliSearch({
      host: "http://meilisearch.reddwarf-toolbox.svc.cluster.local:7700",
      apiKey: masterKey,
    });
    let clientIdx = client.index("files");
    clientIdx.addDocuments([file], option).then((res: any) => {});
    clientIdx.updateFilterableAttributes(["name", "project_id"]);
  } catch (err) {
    logger.error("Failed to sync file index", err);
  }
};
