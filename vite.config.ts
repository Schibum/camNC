import { defineConfig, PluginOption } from "vite";
import preact from "@preact/preset-vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// https://vitejs.dev/config/
export default defineConfig(({ command, ...params }) => {
  let plugins: PluginOption[] = [preact()];
  if (command !== 'serve') plugins.push(viteSingleFile());
  return {
    plugins,
    base: "/present-toolpath",
  };
});
