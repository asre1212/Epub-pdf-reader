import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { validate, sync } from '../worker/src/index.js';

// Load the actual module bodies with deterministic storage dependencies.
function loadModule(path, deps, exports) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];\n/gm, '')
    .replace(/\bexport /g, '');
  return new Function(...Object.keys(deps), source + ';return {' + exports.join(',') + '};')(...Object.values(deps));
}
const book = { id: 'b1', title: 'Book', author: 'Author', format: 'epub', fingerprint: 'edition-a' };
function backupModule(extra = {}) {
  return loadModule('../src/lib/backup.js', {
    APP_VERSION: 'test', listBooks: async () => [book], listHighlights: async () => [],
    listProjects: async () => [{ id: 'p1', name: 'Empty' }],
    listSummaries: async () => [{ id: 'b1', summary: 'Written work', chapters: {} }],
    ...extra,
  }, ['buildBackup', 'parseBackup', 'matchBook', 'restoreBackup', 'highlightKey']);
}
test('full backup preserves summary-only books and empty projects', async () => {
  const result = await backupModule().buildBackup();
  assert.equal(result.books.length, 1);
  assert.equal(result.projects.length, 1);
  assert.equal(result.summaries[0].summary, 'Written work');
});
test('known mismatched fingerprints never match by title or local id', () => {
  const { matchBook } = backupModule();
  assert.equal(matchBook(book, [{ ...book, fingerprint: 'edition-b' }]), null);
  assert.equal(matchBook(book, [{ ...book, id: 'other' }]).id, 'other');
});
test('malformed backups are rejected before any restore writes', async () => {
  let touched = false;
  const { restoreBackup } = backupModule({ withRestoreTransaction: () => { touched = true; } });
  await assert.rejects(restoreBackup({ text: async () => JSON.stringify({
    format: 'marginalia-notes-backup', version: 2, books: [book], highlights: [null],
  }) }), /invalid records/);
  assert.equal(touched, false);
});
test('identical text at distinct PDF rectangles remains distinct', () => {
  const { highlightKey } = backupModule();
  const h = { bookId: 'b', format: 'pdf', page: 1, text: 'repeat' };
  assert.notEqual(highlightKey({ ...h, rects: [{ x: 0.1 }] }), highlightKey({ ...h, rects: [{ x: 0.5 }] }));
});
test('worker accepts all four client record types', () => {
  for (const prefix of ['pos', 'hl', 'pj', 'sm']) {
    assert.equal(validate({ account: 'a'.repeat(64), records: [{ id: prefix + ':a', clientAt: 1, payload: 'cipher' }] }).records.length, 1);
  }
});
function sqliteWorker() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../worker/schema.sql', import.meta.url), 'utf8'));
  return { db, env: { DB: {
    prepare(sql) { return { bind(...args) {
      const statement = db.prepare(sql);
      return {
        run: async () => statement.run(...args),
        all: async () => ({ results: statement.all(...args) }),
        first: async () => statement.get(...args),
      };
    } }; },
    async batch(statements) {
      db.exec('BEGIN');
      try { const result = []; for (const s of statements) result.push(await s.run()); db.exec('COMMIT'); return result; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  } } };
}
test('composite cursors drain 1100 records across a shared sequence boundary', async () => {
  const { db, env } = sqliteWorker();
  try {
    const account = 'a'.repeat(64);
    let number = 0;
    for (const size of [300, 300, 500]) {
      await sync(env, { account, since: 0, records: Array.from({ length: size }, () => ({
        id: 'hl:' + String(number++).padStart(5, '0'), clientAt: 1, payload: 'cipher',
      })) });
    }
    const first = await sync(env, { account, since: 0, records: [] });
    const next = await sync(env, { account, since: first.cursor.seq, afterId: first.cursor.id, records: [] });
    assert.equal(first.records.length, 1000);
    assert.equal(next.records.length, 100);
    assert.equal(new Set([...first.records, ...next.records].map(r => r.id)).size, 1100);
    const legacy = await sync(env, { account, since: 0, records: [] }, false);
    assert.equal(legacy.records.length, 1100);
  } finally { db.close(); }
});
test('D1 transaction rolls back its sequence if a record write fails', async () => {
  const { db, env } = sqliteWorker();
  try {
    await assert.rejects(sync(env, { account: 'a', since: 0, records: [{ id: null, clientAt: 1, payload: 'x' }] }));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 0);
  } finally { db.close(); }
});
test('upload batches honor record count and byte limits', () => {
  const { batchRecords } = loadModule('../src/lib/sync.js', {}, ['batchRecords']);
  const records = Array.from({ length: 1100 }, (_, i) => ({ id: 'hl:' + i, payload: 'x'.repeat(6000) }));
  const batches = batchRecords(records);
  assert.equal(batches.flat().length, 1100);
  for (const batch of batches) {
    assert.ok(batch.length <= 500);
    assert.ok(Buffer.byteLength(JSON.stringify(batch)) < 1800000);
  }
});
