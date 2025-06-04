import { config } from "@wbcnc/eslint-config/react-internal";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...config,
  {
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
];
