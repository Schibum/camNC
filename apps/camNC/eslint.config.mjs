import { config as baseConfig } from "@wbcnc/eslint-config/react-internal";

// /** @type {import("eslint").Linter.FlatConfig[]} */
export default [
  ...baseConfig,
  {
    ignores: ["public/opencv_js.js"],
  },
];
