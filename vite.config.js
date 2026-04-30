import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
  // publicDir: 'public' — needed for dev server to serve GIFs/audio/references.
  // Build cleanup: Vite copies public/ wholesale first, then we remove _work_* from dist.
  publicDir: 'public',
  plugins: [
    {
      name: 'copy-public-assets',
      apply: 'build',
      closeBundle() {
        const dest = path.resolve('dist');
        const skipDirs = ['_work_actions', '_work_idle', '_work_working', '_work_smile'];

        // Remove _work_* directories that Vite already copied
        for (const dir of skipDirs) {
          const dirPath = path.join(dest, 'gifs', dir);
          if (fs.existsSync(dirPath)) {
            fs.rmSync(dirPath, { recursive: true, force: true });
            console.log(`[build-cleanup] Removed dist/gifs/${dir}`);
          }
        }
        console.log('[build-cleanup] Done');
      },
    },
  ],
});
