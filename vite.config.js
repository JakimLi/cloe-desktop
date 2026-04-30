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
  // publicDir: true (default) for dev server; custom copy plugin filters for build
  publicDir: 'public',
  plugins: [
    {
      name: 'copy-public-assets',
      // Only runs during build, not dev
      apply: 'build',
      closeBundle() {
        const src = path.resolve('public');
        const dest = path.resolve('dist');
        const skipDirs = new Set(['_work_actions', '_work_idle', '_work_working', '_work_smile']);

        function copyDir(srcDir, destDir) {
          for (const entry of fs.readdirSync(srcDir)) {
            if (entry === '.DS_Store') continue;
            const srcPath = path.join(srcDir, entry);
            const destPath = path.join(destDir, entry);
            const stat = fs.statSync(srcPath);
            if (stat.isDirectory()) {
              if (skipDirs.has(entry)) continue;
              fs.mkdirSync(destDir, { recursive: true });
              copyDir(srcPath, destPath);
            } else {
              fs.mkdirSync(destDir, { recursive: true });
              fs.copyFileSync(srcPath, destPath);
            }
          }
        }

        copyDir(src, dest);
        console.log('[copy-public] Copied public/ assets to dist/');
      },
    },
  ],
});
