import { build } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

async function main() {
  console.log('[Build] Compiling standalone background.js (IIFE)...');
  await build({
    configFile: false,
    root: rootDir,
    build: {
      outDir: path.resolve(rootDir, 'dist'),
      emptyOutDir: false,
      lib: {
        entry: path.resolve(rootDir, 'src/background/index.ts'),
        name: 'BackgroundWorker',
        formats: ['iife'],
        fileName: () => 'background.js',
      },
    },
  });
  console.log('[Build] Standalone background.js successfully generated.');
}

main().catch((err) => {
  console.error('[Build] Failed to build background:', err);
  process.exit(1);
});
