// The legacy build ships the polyfills pdf.js 6 needs on browsers that do not
// yet have the newest built-ins (Safari and iOS in particular). Behaviour is
// identical to the modern build.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

// One worker configuration for the whole app; pdf.js reads this at getDocument time.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export const { getDocument, TextLayer } = pdfjs;

// CMaps, standard fonts, colour profiles and the image decoders are fetched at
// runtime from the copies scripts/copy-pdfjs-assets.mjs puts in public/pdfjs.
const assetBase = new URL('pdfjs/', document.baseURI).href;

/**
 * Opens a PDF from a Blob. `data` is transferred to the worker, so each call
 * needs its own copy of the bytes.
 */
export async function openPdf(blob) {
  const data = new Uint8Array(await blob.arrayBuffer());
  const loadingTask = getDocument({
    data,
    cMapUrl: `${assetBase}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assetBase}standard_fonts/`,
    iccUrl: `${assetBase}iccs/`,
    wasmUrl: `${assetBase}wasm/`,
    // Books are local files the user picked, but a PDF can still carry embedded
    // scripts and remote references. Keep rendering self-contained.
    isEvalSupported: false,
    disableAutoFetch: true,
    enableXfa: false,
  });
  return loadingTask.promise;
}

/**
 * Tears down a document and its worker. pdf.js v6 moved `destroy` off the
 * document proxy and onto the loading task that produced it.
 */
export function closePdf(pdf) {
  return pdf?.loadingTask?.destroy?.() ?? Promise.resolve();
}
