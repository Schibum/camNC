import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, PluginOption } from "vite";
import checker from "vite-plugin-checker";
// import { viteSingleFile } from 'vite-plugin-singlefile';
// import { nodePolyfills } from 'vite-plugin-node-polyfills';
import tsconfigPaths from "vite-tsconfig-paths";

const ReactCompilerConfig = {
  target: "19",
};
// https://vitejs.dev/config/
export default defineConfig(() => {
  const plugins: PluginOption[] = [
    TanStackRouterVite({ target: "react", autoCodeSplitting: true }),
    react({
      babel: {
        plugins: [
          ["babel-plugin-react-compiler", ReactCompilerConfig],
          ["module:@preact/signals-react-transform"],
        ],
      },
    }),
    tsconfigPaths(),
    tailwindcss(),
    // nodePolyfills(),
    checker({
      typescript: true,
      // eslint: {
      //   lintCommand: 'eslint "./src/**/*.{ts,tsx}"',
      // },
    }),
  ];
  // if (command !== 'serve') plugins.push(viteSingleFile());
  return {
    build: {
      // needed for next-qrcode
      commonjsOptions: { transformMixedEsModules: true },
    },
    plugins,
    server: {
      allowedHosts: [
        "localhost",
        "ff59-2001-16b8-ba8e-8500-b996-64a-7ab4-edec.ngrok-free.app",
      ],
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      },
    },
  };
});
