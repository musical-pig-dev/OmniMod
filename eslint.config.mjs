import fs from "node:fs";
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

const catalogSource = fs.readFileSync(new URL("./src/lib/omnimod/catalog.ts", import.meta.url), "utf8");
const hostKeys = new Set([...catalogSource.matchAll(/key:\s*"([A-Za-z][A-Za-z0-9]*)"/g)].map((match) => match[1]));

const hostKeyRule = {
  meta: {
    type: "problem",
    docs: { description: "Host field keys must be declared on a platform in the catalog." },
    schema: [],
    messages: {
      unknown: "Host key '{{name}}' is not declared in src/lib/omnimod/catalog.ts.",
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (node.computed || node.property.type !== "Identifier" || node.object.type !== "Identifier") return;
        if (node.object.name !== "fields" && node.object.name !== "host" && node.object.name !== "over") return;
        if (hostKeys.has(node.property.name)) return;
        context.report({ node: node.property, messageId: "unknown", data: { name: node.property.name } });
      },
    };
  },
};

/** Flat ESLint config for the TanStack Start app-builder template. */
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      ".output/**",
      ".vercel/**",
      ".nitro/**",
      "node_modules/**",
      "src/routeTree.gen.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["src/lib/omnimod/live.ts", "src/lib/omnimod/publish.ts"],
    plugins: { omnimod: { rules: { "known-host-key": hostKeyRule } } },
    rules: { "omnimod/known-host-key": "error" },
  },
  {
    files: ["browsers/chrome/public/background.js"],
    languageOptions: { globals: { chrome: "readonly" } },
  },
  prettier,
);