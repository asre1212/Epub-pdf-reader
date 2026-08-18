import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      // A hand-written service worker: the Web Share Target below posts files to
      // the app, and only a custom fetch handler can intercept a POST.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      // The app drives updates itself (src/lib/appUpdates.js) so it can offer a
      // real Update button and hold a reload back until nobody is mid-page.
      registerType: 'prompt',
      injectManifest: {
        // The pdf.js worker is large, but it has to be there when we are offline.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: [
          '**/*.{js,mjs,css,html,svg,png,ico,woff2,webmanifest}',
          // pdf.js needs these for most real-world PDFs, so they belong offline.
          'pdfjs/standard_fonts/*.{pfb,ttf}',
          'pdfjs/wasm/*.wasm',
          'pdfjs/iccs/*.icc',
        ],
        globIgnores: [
          // Only used when WebAssembly is unavailable; cached at runtime instead.
          '**/pdfjs/wasm/*_nowasm_fallback.js',
          '**/pdfjs/**/LICENSE*',
        ],
      },
      devOptions: { enabled: false, type: 'module' },
      manifest: {
        name: 'Marginalia — EPUB & PDF Reader',
        short_name: 'Marginalia',
        description:
          'Read EPUB and PDF books offline, highlight as you go, and keep every highlight in one notebook.',
        lang: 'en',
        theme_color: '#16161a',
        background_color: '#16161a',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        categories: ['books', 'education', 'productivity'],
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // Lets Android crop the icon to its launcher shape without clipping the book.
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Puts the installed app in the OS "Open with" list for books.
        file_handlers: [
          {
            action: './',
            accept: {
              'application/epub+zip': ['.epub'],
              'application/pdf': ['.pdf'],
            },
          },
        ],
        // Lets the installed app receive books from the system share sheet.
        share_target: {
          action: './',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            files: [
              {
                name: 'book',
                accept: ['application/epub+zip', 'application/pdf', '.epub', '.pdf'],
              },
            ],
          },
        },
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('pdfjs-dist')) return 'pdfjs';
          if (id.includes('epubjs') || id.includes('jszip')) return 'epubjs';
          if (id.includes('node_modules/react')) return 'react';
        },
      },
    },
  },
  optimizeDeps: {
    include: ['epubjs', 'jszip'],
  },
});
