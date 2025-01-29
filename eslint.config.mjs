import globals from "globals";
import pluginJs from "@eslint/js";

/** @type {import('eslint').Linter.Config[]} */
export default [
  { 
    languageOptions: { globals: globals.browser } ,
    ignores: [
      "**/temp.js", 
      "config/*",
      "dist/**",
      "node_modules/**"
    ]
  },
  pluginJs.configs.recommended,
];
