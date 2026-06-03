import js from "@eslint/js";
import tseslint from "typescript-eslint";

const unusedIgnorePatterns = {
  argsIgnorePattern: "^_",
  caughtErrorsIgnorePattern: "^_",
  varsIgnorePattern: "^_",
};

export default tseslint.config(
  {
    ignores: ["node_modules/**", ".pi/**", ".worktrees/**", "dist/**", "coverage/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "no-control-regex": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", unusedIgnorePatterns],
    },
  },
  {
    files: ["**/*.{js,mjs}"],
    rules: {
      "no-control-regex": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-undef": "off",
      "no-unused-vars": ["error", unusedIgnorePatterns],
    },
  },
);
