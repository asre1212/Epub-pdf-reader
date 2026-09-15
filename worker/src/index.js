/**
 * Marginalia sync.
 *
 * Keeps reading positions and highlights in step across a phone and a tablet.
 * Deliberately knows nothing about what it is storing:
 *
 *  - The device derives an account id and an encryption key from one sync code.
 *    Only the id is ever sent, and it is a SHA-256 hash of the code, so the
 *    code cannot be recovered from it.
 *  - Every record body is AES-GCM ciphertext produced on the device. This
 *    Worker moves opaque strings around; it cannot read a highlight, a book
 *    title, or how far through anything somebody is.
 *
 * There are no user accounts, no passwords and no secrets in the Worker. The
 * sync code is the whole credential, which is why it is 128 bits of randomness.
 */

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_RECORDS_PER_PUSH = 500;
const MAX_PAYLOAD_CHARS = 64 * 1024;
const MAX_PULL = 1000;
const ACCOUNT_RE = /^[0-9a-f]{64}$/;
const RECORD_ID_RE = /^(pos|hl|pj|sm):[A-Za-z0-9._:-]{1,200}$/;

function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || '*').trim();
  const origin = request.headers.get('Origin') || '';
  let allowOrigin = '*';
  if (allowed !== '*') {
    const list = allowed.split(',').map((s) => s.trim()).filter(Boolean);
    allowOrigin = list.includes(origin) ? origin : list[0] || 'null';
  }
  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

function json(body, { status = 200, request, env } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(request ? corsHeaders(request, env) : {}),
    },
  });
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readBody(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_BODY_BYTES) throw new HttpError(413, 'Request too large.');
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'Request too large.');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Body must be JSON.');
  }
}

export function validate(body) {
  const account = String(body?.account || '');
  if (!ACCOUNT_RE.test(account)) throw new HttpError(400, 'Bad account id.');

  const rawCursor = body?.since;
  const since = Number(rawCursor && typeof rawCursor === 'object' ? rawCursor.seq : rawCursor ?? 0);
  const afterId = rawCursor && typeof rawCursor === 'object' ? String(rawCursor.id || '') : '';
  if (afterId && !RECORD_ID_RE.test(afterId)) throw new HttpError(400, 'Bad cursor.');
  if (!Number.isFinite(since) || since < 0) throw new HttpError(400, 'Bad cursor.');

  const records = Array.isArray(body?.records) ? body.records : [];
  if (records.length > MAX_RECORDS_PER_PUSH) {
    throw new HttpError(413, `At most ${MAX_RECORDS_PER_PUSH} records per request.`);
  }

  for (const record of records) {
    if (!RECORD_ID_RE.test(String(record?.id || ''))) throw new HttpError(400, 'Bad record id.');
    const clientAt = Number(record?.clientAt);
    if (!Number.isFinite(clientAt) || clientAt <= 0) throw new HttpError(400, 'Bad record time.');
    if (record.deleted) continue;
    if (typeof record.payload !== 'string' || !record.payload) {
      throw new HttpError(400, 'A record needs a payload unless it is a deletion.');
    }
    if (record.payload.length > MAX_PAYLOAD_CHARS) throw new HttpError(413, 'Record too large.');
  }

  return { account, since: Math.floor(since), afterId, records };
}

/**
 * Applies a push and returns everything the caller has not seen yet, in one
 * round trip. Writes land under a single new sequence number, so a device can
 * pull with `> cursor` and never miss or repeat a record.
 */
export async function sync(env, { account, since, afterId = '', records }, composite = true) {
  const db = env.DB;
  const now = Date.now();
  if (records.length) {
    // D1 batch is one transaction: no reader can see the counter before the records.
    const bump = db.prepare(
      'INSERT INTO accounts (account, seq, updated_at) VALUES (?, 1, ?) ON CONFLICT(account) DO UPDATE SET seq = accounts.seq + 1, updated_at = excluded.updated_at'
    ).bind(account, now);
    const upsert = db.prepare(
      'INSERT INTO records (account, id, seq, client_at, deleted, payload) VALUES (?, ?, (SELECT seq FROM accounts WHERE account = ?), ?, ?, ?) ON CONFLICT(account, id) DO UPDATE SET seq = excluded.seq, client_at = excluded.client_at, deleted = excluded.deleted, payload = excluded.payload WHERE excluded.client_at >= records.client_at'
    );
    await db.batch([bump, ...records.map(r => upsert.bind(
      account, r.id, account, Math.floor(Number(r.clientAt)), r.deleted ? 1 : 0, r.deleted ? null : r.payload
    ))]);
  }
  const { results = [] } = await db.prepare(
    'SELECT id, seq, client_at, deleted, payload FROM records WHERE account = ? AND (seq > ? OR (seq = ? AND id > ?)) ORDER BY seq ASC, id ASC LIMIT ?'
  ).bind(account, since, since, composite ? afterId : '\uffff', MAX_PULL + 1).all();
  let rows = results.slice(0, MAX_PULL);
  const more = results.length > MAX_PULL;
  // Old clients have scalar cursors. Return the entire boundary sequence to them.
  if (!composite && more && rows.length) {
    const last = rows.at(-1);
    const { results: tail = [] } = await db.prepare(
      'SELECT id, seq, client_at, deleted, payload FROM records WHERE account = ? AND seq = ? AND id > ? ORDER BY id ASC'
    ).bind(account, last.seq, last.id).all();
    rows = rows.concat(tail);
  }
  const last = rows.at(-1);
  return {
    seq: last?.seq ?? since,
    cursor: composite ? { seq: last?.seq ?? since, id: last?.id ?? afterId } : last?.seq ?? since,
    more,
    records: rows.map(row => ({
      id: row.id, seq: row.seq, clientAt: row.client_at,
      deleted: !!row.deleted, payload: row.payload,
    })),
    serverTime: now,
    protocol: 2,
  };
}

async function forget(env, account) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM records WHERE account = ?').bind(account),
    env.DB.prepare('UPDATE accounts SET seq = seq + 1 WHERE account = ?').bind(account),
  ]);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    if (url.pathname === '/v1/health') {
      return json({ ok: true, service: 'marginalia-sync', protocol: 2 }, { request, env });
    }

    try {
      if (['/v1/sync', '/v2/sync'].includes(url.pathname) && request.method === 'POST') {
        const input = validate(await readBody(request));
        return json(await sync(env, input, url.pathname === '/v2/sync'), { request, env });
      }

      if (url.pathname === '/v1/forget' && request.method === 'POST') {
        const body = await readBody(request);
        const account = String(body?.account || '');
        if (!ACCOUNT_RE.test(account)) throw new HttpError(400, 'Bad account id.');
        await forget(env, account);
        return json({ ok: true }, { request, env });
      }
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      return json(
        { error: status === 500 ? 'Something went wrong.' : err.message },
        { status, request, env },
      );
    }

    return json({ error: 'Not found.' }, { status: 404, request, env });
  },
};
