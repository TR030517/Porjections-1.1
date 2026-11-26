import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // 生产部署在 Nginx 子路径 /merchant/ 下（dev 时不影响）
  base: '/merchant/',
  plugins: [react()],
  build: {
    manifest: true,
    rolldownOptions: {
      output: {
        // Separate the stable hook runtime without merging unused route UI into it.
        codeSplitting: {
          groups: [{ name: 'react-runtime', test: /node_modules[\\/](?:react|react-dom|scheduler)(?:[\\/]|$)/, priority: 20 }],
        },
      },
    },
  },
  // Shared store components live above merchant-web; use this app's hook dispatcher.
  resolve: { dedupe: ['react', 'react-dom'] },
  server: {
    host: '127.0.0.1',
    port: 3002,
    strictPort: true,
    proxy: {
      '/api': {
        // 容器内 dev 时通过 VITE_PROXY_TARGET=http://server:8000 覆盖
        target: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:8002',
        changeOrigin: false,
      },
    },
  },
});
