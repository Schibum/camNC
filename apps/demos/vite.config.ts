import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, PluginOption } from "vite";
import checker from "vite-plugin-checker";
// import { viteSingleFile } from 'vite-plugin-singlefile';
// import { nodePolyfills } from 'vite-plugin-node-polyfills';
import tsconfigPaths from "vite-tsconfig-paths";

// https://vitejs.dev/config/
export default defineConfig(({ command, ...params }) => {
  const plugins: PluginOption[] = [
    TanStackRouterVite({ target: "react", autoCodeSplitting: true }),
    react(),
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
    plugins,
    server: {
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      },
    },
  };
});
