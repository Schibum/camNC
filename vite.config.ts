import { defineConfig, PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import checker from "vite-plugin-checker";

// https://vitejs.dev/config/
export default defineConfig(({ command, ...params }) => {
  let plugins: PluginOption[] = [
    react(),
    checker({
      typescript: true,
      // eslint: {
      //   lintCommand: 'eslint "./src/**/*.{ts,tsx}"',
      // },
    }),
  ];
  if (command !== 'serve') plugins.push(viteSingleFile());
  return {
    plugins,
    base: "/present-toolpath",
  };
});

