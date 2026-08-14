import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Build output, vendored files inside the virtualenv, and local agent state.
    ignores: ["**/dist/**", "**/coverage/**", "node_modules/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["*.{js,mjs,ts}"],
    languageOptions: { globals: globals.node },
  },
);
