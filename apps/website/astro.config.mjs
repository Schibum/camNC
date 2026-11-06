import tailwindcss from "@tailwindcss/vite";

import icon from "astro-icon";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
    ssr: {
      // Keep CommonJS embed dependencies and Zod's namespace in the same bundle.
      noExternal: ["zod"],
    },
  },
  site: "https://www.camnc.app/",
  integrations: [icon()],
});
