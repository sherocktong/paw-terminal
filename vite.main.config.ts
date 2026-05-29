import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/main/main.ts'),
      formats: ['cjs'],
      fileName: () => 'main.cjs',
    },
    outDir: 'dist/main',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      external: ['electron', 'node-pty', 'fs', 'path', 'os', 'url', 'crypto', 'child_process', 'util'],
    },
  },
});
