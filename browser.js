// This file provides browser-specific implementations or empty stubs
// for Node.js specific functionality

// Empty implementation for fulltext search that works in browser environments
export const updateFullsearch = async () => {
  console.log("MeiliSearch operations are not supported in browser environments");
  return;
};

// Default export for compatibility
export default {
  updateFullsearch
}; 