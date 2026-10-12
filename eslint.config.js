import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["dist/**", "node_modules/**", "playwright-report/**", "test-results/**"]
  },
  {
    ...js.configs.recommended,
    files: [
      "src/App.jsx",
      "src/main.jsx",
      "src/config/portalRegistry.js",
      "src/components/PortalNavigation.jsx",
      "tests/e2e/app-shell.spec.js",
      "playwright.config.js"
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node
      },
      parserOptions: {
        ecmaFeatures: { jsx: true }
      }
    },
    rules: {
      "no-unused-vars": "off",
      "no-undef": "error"
    }
  }
];
