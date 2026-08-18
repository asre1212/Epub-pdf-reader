/**
 * pdf.js loads CMaps, standard fonts, ICC profiles and its wasm decoders at
 * runtime rather than through the bundler. They are copied into public/ so Vite
 * serves them in dev and emits them into dist/ for the service worker to cache.
 */
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = resolve(root, 'node_modules/pdfjs-dist');
const to = resolve(root, 'public/pdfjs');

// quickjs is only used to run scripted PDFs, which this reader disables.
const SKIP = /quickjs/;

await rm(to, { recursive: true, force: true });
await mkdir(to, { recursive: true });

for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  await cp(resolve(from, dir), resolve(to, dir), {
    recursive: true,
    filter: (src) => !SKIP.test(src),
  });
}

console.log(`pdf.js runtime assets copied to public/pdfjs`);
