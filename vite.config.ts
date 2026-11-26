import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    base: '/admin/',
    plugins: [react(), tailwindcss()],
    build: {
      manifest: true,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [{ name: 'react-runtime', test: /node_modules[\\/](?:react|react-dom|scheduler)(?:[\\/]|$)/, priority: 20 }],
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      host: '127.0.0.1',
      port: 3000,
      strictPort: true,
      proxy: { '/api': { target: 'http://127.0.0.1:8002', changeOrigin: false } },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Local databases, credentials and backup staging are not application sources.
      // Watching their child directories prevents atomic backup renames on Windows.
      watch: process.env.DISABLE_HMR === 'true' ? null : { ignored: ['**/.local/**'] },
    },
    preview: { host: '127.0.0.1', strictPort: true },
  };
});
