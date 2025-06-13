import { config as baseConfig } from "@wbcnc/eslint-config/react-internal"

/** @type {import("eslint").Linter.FlatConfig[]} */
export default [
  ...baseConfig,
  {
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
]
