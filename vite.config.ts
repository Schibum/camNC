import tailwindcss from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig, PluginOption } from "vite";
import checker from "vite-plugin-checker";
import { viteSingleFile } from "vite-plugin-singlefile";



// https://vitejs.dev/config/
export default defineConfig(({ command, ...params }) => {
  let plugins: PluginOption[] = [
    TanStackRouterVite({ target: 'react', autoCodeSplitting: true }),
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
    // base: "/present-toolpath",
  };
});

