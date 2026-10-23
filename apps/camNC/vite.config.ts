import tailwindcss from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, PluginOption } from 'vite';
import checker from 'vite-plugin-checker';
// import { viteSingleFile } from 'vite-plugin-singlefile';
import devtoolsJson from 'vite-plugin-devtools-json';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import tsconfigPaths from 'vite-tsconfig-paths';

const ReactCompilerConfig = {
  target: '19',
};

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  const plugins: PluginOption[] = [
    devtoolsJson(),

    tsconfigPaths(),
    TanStackRouterVite({ target: 'react', autoCodeSplitting: true }),
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler', ReactCompilerConfig], ['module:@preact/signals-react-transform']],
      },
    }),
    tailwindcss(),
    nodePolyfills({
      // For gstream-parser
      include: ['stream', '_stream_transform', 'util'],
      protocolImports: false,
      globals: {
        // Vite 8's Rolldown dep optimizer no longer injects the process shim on its own,
        // and util/readable-stream (via gcode-toolpath) read process in dev.
        process: 'dev',
      },
    }),
  ];
  // Type errors show in dev; builds skip it since CI runs check-types.
  if (command === 'serve') {
    plugins.push(
      checker({
        typescript: true,
        // eslint: {
        //   lintCommand: 'eslint "./src/**/*.{ts,tsx}"',
        // },
      })
    );
  }
  // if (command !== 'serve') plugins.push(viteSingleFile());
  return {
    build: {
      // needed for next-qrcode
      commonjsOptions: { transformMixedEsModules: true },
    },
    plugins,
    optimizeDeps: {
      // Without it, framer-motion's circular imports (via HeroUI) run out of order in dev
      // ("Class extends value undefined").
      rolldownOptions: { output: { strictExecutionOrder: true } },
    },
    // Production headers are in public/_headers
    server: {
      // Settings API, run it with `pnpm dev:api`.
      proxy: { '/api': 'http://localhost:8787' },
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
  };
});
