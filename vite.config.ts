import { defineConfig, PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// https://vitejs.dev/config/
export default defineConfig(({ command, ...params }) => {
  let plugins: PluginOption[] = [react()];
  if (command !== 'serve') plugins.push(viteSingleFile());
  return {
    plugins,
    base: "/present-toolpath",
  };
});
