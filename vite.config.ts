import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',
  root: './src/renderer',
  publicDir: './public',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'audioProcessor.js') return 'audioProcessor.js';
          return 'assets/[name]-[hash][extname]';
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    hmr: {
      host: '127.0.0.1',
      protocol: 'ws'
    }
  }
});
