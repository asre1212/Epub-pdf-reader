/**
 * Renders the PNG app icons from public/icon.svg.
 *
 * Run this after editing the SVG:  node scripts/generate-icons.mjs
 *
 * Rasterising needs a browser engine, which is not something this project should
 * depend on just to build. Playwright is used if it happens to be installed
 * (`npm i -D playwright`); otherwise the committed PNGs are left alone. Set
 * CHROMIUM_PATH to point at an existing Chromium binary if Playwright has not
 * downloaded one.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const svgPath = resolve(root, 'public/icon.svg');
const iconDir = resolve(root, 'public/icons');

// "any" icons are full-bleed. A maskable icon must survive a circular crop, so
// its artwork is shrunk to fit the 80% safe circle while the background bleeds.
// The artwork's bounding box diagonal is about 452 units of the 512 canvas, so
// anything up to ~0.9 stays inside the circle; 0.8 leaves a little breathing room.
const TARGETS = [
  { file: 'icon-192.png', size: 192, artScale: 1 },
  { file: 'icon-512.png', size: 512, artScale: 1 },
  { file: 'icon-maskable-512.png', size: 512, artScale: 0.8 },
  // iOS uses this one for Add to Home Screen, and rounds the corners itself.
  { file: 'apple-touch-icon.png', size: 180, artScale: 1 },
];

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error(
    'Icons not regenerated: playwright is not installed.\n' +
      'Install it with `npm i -D playwright` if you need to rebuild them.',
  );
  process.exit(0);
}

const svg = await readFile(svgPath, 'utf-8');

// Set CHROMIUM_PATH when Playwright's own browser download is not where it
// expects (a preinstalled Chromium, a CI image, a distro package).
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const { file, size, artScale } of TARGETS) {
    const scaled =
      artScale === 1
        ? svg
        : svg.replace(
            '<g id="art">',
            `<g id="art" transform="translate(256 256) scale(${artScale}) translate(-256 -256)">`,
          );

    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<!doctype html><style>
         html,body{margin:0;padding:0;width:${size}px;height:${size}px;overflow:hidden}
         svg{display:block;width:${size}px;height:${size}px}
       </style>${scaled}`,
      { waitUntil: 'load' },
    );
    const png = await page.screenshot({ omitBackground: false });
    await writeFile(resolve(iconDir, file), png);
    await page.close();
    console.log(`${file} — ${size}×${size}, ${Math.round(png.length / 1024)} KB`);
  }
} finally {
  await browser.close();
}
