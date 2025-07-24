import tailwindcss from '@tailwindcss/vite';
// import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, PluginOption } from 'vite';
import checker from 'vite-plugin-checker';
// import { viteSingleFile } from 'vite-plugin-singlefile';
import postgresPlugin from '@neondatabase/vite-plugin-postgres';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import devtoolsJson from 'vite-plugin-devtools-json';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import tsconfigPaths from 'vite-tsconfig-paths';

const ReactCompilerConfig = {
  target: '19',
};

// https://vitejs.dev/config/
export default defineConfig(() => {
  const plugins: PluginOption[] = [
    devtoolsJson(),

    tsconfigPaths(),
    postgresPlugin(),
    tanstackStart({
      customViteReactPlugin: true,
      target: 'cloudflare-module', // Key configuration for Cloudflare compatibility

      // spa: {
      //   enabled: true,
      // },
    }) as PluginOption,

    // TanStackRouterVite({ target: 'react', autoCodeSplitting: true }),
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler', ReactCompilerConfig], ['module:@preact/signals-react-transform']],
      },
    }),
    tailwindcss(),
    nodePolyfills({
      // For gstream-parser
      include: ['stream', '_stream_transform', 'util'],
      // tanstack-start build blows without this
      protocolImports: false,
      globals: {
        process: false,
      },
    }),
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
    // Also in server.ts for dynamic content
    server: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
  };
});
