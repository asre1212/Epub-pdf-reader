const SHARE_CACHE = 'marginalia-share-inbox';

/**
 * Drains files that the service worker stashed when the OS share sheet posted a
 * book to the app. Returns File objects ready to hand to the importer.
 */
export async function drainSharedFiles() {
  if (!('caches' in globalThis)) return [];
  let cache;
  try {
    cache = await caches.open(SHARE_CACHE);
  } catch {
    return [];
  }
  const requests = await cache.keys();
  const files = [];
  for (const request of requests) {
    const response = await cache.match(request);
    if (response) {
      const name = decodeURIComponent(response.headers.get('x-filename') || 'shared-book');
      const type = response.headers.get('content-type') || '';
      files.push({ file: new File([await response.blob()], name, { type }), request });
    }
  }
  return files;
}

/** Remove an inbox item only after the original file and metadata have committed. */
export async function acknowledgeSharedFile(request) {
  const cache = await caches.open(SHARE_CACHE);
  await cache.delete(request);
}
