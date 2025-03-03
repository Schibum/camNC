import { defineConfig, PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import checker from "vite-plugin-checker";
import tailwindcss from '@tailwindcss/vite'
import path from "path";


// https://vitejs.dev/config/
export default defineConfig(({ command, ...params }) => {
  let plugins: PluginOption[] = [
    react(),
    tailwindcss(),
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
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    base: "/present-toolpath",
  };
});

