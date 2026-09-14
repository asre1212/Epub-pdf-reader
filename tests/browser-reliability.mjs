import { chromium, webkit } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4173'], { stdio: 'inherit' });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch('http://127.0.0.1:4173/tests/reliability.html')).ok) { ready = true; break; } } catch {}
    await delay(500);
  }
  assert.ok(ready, 'Vite starts');
  browser = await (process.env.BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/tests/reliability.html');
  await page.waitForFunction(() => window.harnessReady);

  const dbChecks = await page.evaluate(async () => {
    const db = await import('/src/lib/db.js');
    const { buildBackup, restoreBackup } = await import('/src/lib/backup.js');
    const book = { id: 'test-book', title: 'Book', author: 'Author', format: 'epub', fingerprint: 'edition-a' };
    await db.putBook(book);
    await db.saveSummary(book.id, { summary: 'Keep my work' });
    await db.putProject({ id: 'empty-project', name: 'Empty' });
    const backup = await buildBackup();
    if (backup.summaries.length !== 1 || backup.projects.length !== 1) throw new Error('Full backup incomplete');
    const h = { id: 'test-highlight', bookId: book.id, format: 'epub', cfi: 'epubcfi(/6/2!/4/2)', text: 'Quote', createdAt: 1 };
    await db.putHighlight(h);
    const saved = await buildBackup();
    await db.deleteHighlight(h.id);
    await restoreBackup({ text: async () => JSON.stringify(saved) });
    if ((await db.listTombstones()).some(t => t.id === h.id)) throw new Error('Restore retained deletion marker');
    const restored = (await db.listHighlights())[0];
    if (restored.updatedAt <= 1) throw new Error('Restore did not stamp new write');
    await db.mergeRemoteRecord({ id: 'hl:' + h.id, clientAt: 2, deleted: true }, null);
    if (!(await db.listHighlights()).length) throw new Error('Old remote deletion won');
    try {
      await db.withRestoreTransaction(async ({ putBook }) => {
        await putBook({ ...book, id: 'rollback-book' });
        throw new Error('intentional failure');
      });
    } catch {}
    if (await db.getBook('rollback-book')) throw new Error('Restore did not roll back');
    const { importFile } = await import('/src/lib/importBook.js');
    for (const format of ['epub', 'pdf']) {
      const response = await fetch('/tests/fixtures/book.' + format);
      const file = new File([await response.blob()], 'book.' + format);
      const result = await importFile(file);
      if (!(await db.hasBookFile(result.book.id))) throw new Error('Imported file missing');
      if (format === 'pdf' && !result.book.cover) throw new Error('PDF fixture cover missing');
      if (format === 'pdf') await db.putHighlight({ id: 'pdf-drawer', bookId: result.book.id, format: 'pdf', page: 1, text: 'Drawer test quote', rects: [], createdAt: Date.now() });
    }
    const { default: JSZip } = await import('/node_modules/.vite/deps/jszip.js');
    const { extractEpubCover } = await import('/src/lib/covers.js');
    const canvas = document.createElement('canvas'); canvas.width = 20; canvas.height = 30;
    canvas.getContext('2d').fillRect(0, 0, 20, 30);
    const png = await new Promise(resolve => canvas.toBlob(resolve));
    for (const version of [2, 3]) {
      const zip = new JSZip();
      zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>');
      zip.file('OEBPS/book.opf', '<package><metadata>' + (version === 2 ? '<meta name="cover" content="jacket"/>' : '') +
        '</metadata><manifest><item id="jacket" href="Images/front.png" media-type="image/png"' +
        (version === 3 ? ' properties="cover-image"' : '') + '/></manifest></package>');
      zip.file('OEBPS/Images/front.png', await png.arrayBuffer());
      if (!(await extractEpubCover(await zip.generateAsync({ type: 'blob' })))) throw new Error('EPUB cover extraction failed: ' + version);
    }
    return true;
  });
  assert.ok(dbChecks);
  console.log('PASS: real IndexedDB backup, restore rollback, tombstones, stale deletion, EPUB/PDF imports');

  await page.evaluate(() => { window.failSave = true; window.showDraft(); });
  const input = page.getByRole('textbox', { name: 'Test draft' });
  await input.fill('Retain this draft');
  await input.blur();
  await page.getByRole('alert').waitFor();
  await page.reload();
  await page.waitForFunction(() => window.harnessReady);
  await page.evaluate(() => window.showDraft());
  await assert.doesNotReject(() => input.waitFor());
  assert.equal(await input.inputValue(), 'Retain this draft');
  await page.evaluate(() => window.showDraft('Remote changed value'));
  await delay(100);
  assert.equal(await input.inputValue(), 'Retain this draft');
  await input.focus();
  await input.press('Escape');
  assert.equal(await input.inputValue(), 'Remote changed value');
  assert.equal(await page.evaluate(() => localStorage.getItem('marginalia-draft:test')), null);
  assert.equal(await page.evaluate(() => window.savedText), undefined);
  console.log('PASS: failed-save draft survives reload, remote change preserves draft, Escape does not commit');

  await page.evaluate(() => window.showCover());
  await page.getByText('Fallback title').waitFor();
  console.log('PASS: invalid cover image displays title fallback');

  await page.goto('http://127.0.0.1:4173/');
  await page.locator('.card-open').filter({ has: page.locator('.chip-pdf') }).first().click();
  await page.locator('.pdf-page[data-render-scale]').first().waitFor();
  assert.ok(await page.getByRole('button', { name: 'Contents', exact: true }).isEnabled());
  await page.getByRole('button', { name: 'Contents', exact: true }).click();
  await page.getByRole('tab', { name: /Highlights/ }).click();
  await page.getByText('Drawer test quote').click();
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await page.getByRole('button', { name: 'Previous page', exact: true }).click();
  await page.getByRole('button', { name: 'Back to library', exact: true }).click();
  await page.locator('.card-open').filter({ has: page.locator('.chip-epub') }).filter({ hasNotText: 'NOTES ONLY' }).last().click();
  await page.waitForFunction(() => [...document.querySelectorAll('iframe')].some(f => f.contentDocument?.body?.textContent?.trim()));
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await page.getByRole('button', { name: 'Previous page', exact: true }).click();
  console.log('PASS: app mounts, PDF renders, highlights drawer opens, EPUB renders, reader navigation responds');
  assert.deepEqual(errors, [], 'No uncaught browser errors');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
