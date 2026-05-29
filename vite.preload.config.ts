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
      entry: path.resolve(__dirname, 'src/preload/preload.ts'),
      formats: ['cjs'],
      fileName: () => 'preload.cjs',
    },
    outDir: 'dist/preload',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      external: ['electron'],
    },
  },
});
