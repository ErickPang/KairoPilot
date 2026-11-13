import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import type { WarningHandlerWithDefault } from 'rollup';

// Zod mentions PURE markers in prose; only suppress these two known explanatory comments.
const onBuildWarning: WarningHandlerWithDefault = (warning, fallback) => {
  const id = (warning.id || '').replace(/\\/g, '/');
  if (warning.code === 'INVALID_ANNOTATION' && (
    id.endsWith('/node_modules/zod/v4/core/regexes.js') && warning.message.includes('Anchors a pattern source.') ||
    id.endsWith('/node_modules/zod/v4/core/util.js') && warning.message.includes('Wrapped in a `@__PURE__` IIFE')
  )) return;
  fallback(warning);
};

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    rollupOptions: {
      onwarn: onBuildWarning,
      output: { manualChunks: { react: ['react', 'react-dom'], markdown: ['react-markdown', 'remark-gfm'] } }
    }
  },
  plugins: [
    react(),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: 'src/main/index.ts',
        vite: {
          build: {
            rollupOptions: {
              onwarn: onBuildWarning,
              external: ['better-sqlite3'],
            },
          },
        },
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: 'src/preload/index.ts',
      },
      // Ployfill the Electron and Node.js API for Renderer process.
      // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer: process.env.NODE_ENV === 'test'
        // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
        ? undefined
        : {},
    }),
  ],
})
