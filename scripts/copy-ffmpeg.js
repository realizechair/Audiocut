// Copy ffmpeg-core files from node_modules to both public/ and dist/ after build
// The wasm file (~31MB) is not checked into git - it's fetched via npm install
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const src = resolve(root, 'node_modules/@ffmpeg/core/dist/umd');
const targets = [
  resolve(root, 'public/static/ffmpeg'),
  resolve(root, 'dist/static/ffmpeg'),
];
const files = ['ffmpeg-core.js', 'ffmpeg-core.wasm'];

for (const dest of targets) {
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }
  for (const file of files) {
    const srcFile = resolve(src, file);
    const destFile = resolve(dest, file);
    if (existsSync(srcFile)) {
      copyFileSync(srcFile, destFile);
      console.log(`Copied: ${file} -> ${dest.replace(root, '.')}`);
    } else {
      console.warn(`Warning: ${srcFile} not found`);
    }
  }
}

console.log('Done: ffmpeg-core files copied.');
