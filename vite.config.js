import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
  // 排除 _work_* 和中间产物，只打包最终 GIF 和 audio
  publicDir: false,
});
