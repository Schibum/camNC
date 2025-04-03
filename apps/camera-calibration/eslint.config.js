import { config } from "@repo/eslint-config/react-internal";
import { globalIgnores } from "eslint/config";


// /** @type {import("eslint").Linter.Config} */
export default [
  globalIgnores(["src/opencv_js.js", "public/opencv.js", "public/opencv_js.js"]),
  ...config,
];
