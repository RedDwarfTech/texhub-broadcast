import log4js from "log4js";
var logger = log4js.getLogger();

// Only import MeiliSearch types in Node.js environment
import type { MeiliSearch } from "meilisearch";

export const updateFullsearch = async (file: any) => {
  // Only proceed in Node.js environment
  if (typeof window !== 'undefined') {
    logger.info("Skipping MeiliSearch initialization in non-Node environment");
    return;
  }
  
  try {
    // Dynamically import MeiliSearch only in Node.js environment
    const { MeiliSearch } = await import('meilisearch');
    
    const masterKey = process.env.MEILI_MASTER_KEY;
    let option: any = {
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
