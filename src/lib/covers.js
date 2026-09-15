import JSZip from 'jszip';

export async function normalizeCover(blob) {
  if (!(blob instanceof Blob) || !blob.size) return null;
  const url = URL.createObjectURL(blob);
  const img = new Image();
  let timer;
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Cover image timed out')), 10000);
      img.onload = resolve; img.onerror = reject; img.src = url;
    });
    if (!img.naturalWidth || !img.naturalHeight) return null;
    const scale = Math.min(600 / img.naturalWidth, 900 / img.naturalHeight, 1);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  } catch { return null; }
  finally { clearTimeout(timer); img.src = ''; URL.revokeObjectURL(url); }
}

export function resolveArchivePath(base, href) {
  if (!href || /^(?:[a-z]+:|\/\/)/i.test(href)) return null;
  let path;
  try { path = decodeURIComponent(href.split('#')[0].split('?')[0]); } catch { return null; }
  const parts = path.startsWith('/') ? [] : base.split('/').slice(0, -1);
  for (const part of path.split('/')) {
    if (part === '..') { if (!parts.length) return null; parts.pop(); }
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

/** EPUB 2/3 declarations, cover documents, then early spine images. Never fetch external URLs. */
export async function extractEpubCover(blob) {
  const zip = await JSZip.loadAsync(blob);
  const xml = async path => {
    const file = zip.file(path);
    return file ? new DOMParser().parseFromString(await file.async('string'), 'application/xml') : null;
  };
  const nodes = (doc, tag) => [...(doc?.getElementsByTagNameNS('*', tag) || [])];
  const container = await xml('META-INF/container.xml');
  const opfPath = nodes(container, 'rootfile')[0]?.getAttribute('full-path');
  if (!opfPath) return null;
  const opf = await xml(opfPath);
  const items = nodes(opf, 'item');
  const byId = new Map(items.map(n => [n.getAttribute('id'), n]));
  const coverId = nodes(opf, 'meta').find(n => n.getAttribute('name') === 'cover')?.getAttribute('content');
  const candidates = [
    ...items.filter(n => (n.getAttribute('properties') || '').split(/\s+/).includes('cover-image')),
    byId.get(coverId),
    ...nodes(opf, 'reference').filter(n => n.getAttribute('type') === 'cover'),
    ...items.filter(n => /cover/i.test(n.getAttribute('id') || '') || /cover/i.test(n.getAttribute('href') || '')),
    ...nodes(opf, 'itemref').slice(0, 5).map(n => byId.get(n.getAttribute('idref'))),
  ].filter(Boolean);
  const visited = new Set();
  async function readImage(path, depth = 0) {
    if (!path || visited.has(path) || depth > 3) return null;
    visited.add(path);
    const file = zip.file(path);
    if (!file) return null;
    const ext = path.split('.').pop().toLowerCase();
    const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif' }[ext];
    if (mime) {
      const image = await normalizeCover(new Blob([await file.async('uint8array')], { type: mime }));
      if (image) return image;
    }
    if (!mime || ext === 'svg') {
      const doc = await xml(path);
      for (const n of [...nodes(doc, 'img'), ...nodes(doc, 'image')]) {
        const href = n.getAttribute('src') || n.getAttribute('href') || n.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
        const image = await readImage(resolveArchivePath(path, href), depth + 1);
        if (image) return image;
      }
    }
    return null;
  }
  for (const item of candidates) {
    const image = await readImage(resolveArchivePath(opfPath, item.getAttribute('href')));
    if (image) return image;
  }
  return null;
}
