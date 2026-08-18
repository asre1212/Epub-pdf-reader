# Marginalia sync worker

Keeps reading positions and highlights in step between devices. It stores
records for an account id and hands them back; it cannot read any of them.

- The device derives an **account id** and an **encryption key** from one sync
  code. Only the id is ever sent, and it is a hash, so the code cannot be
  recovered from it.
- Every record body is **AES-GCM ciphertext** produced on the device. This
  Worker moves opaque strings around — it cannot see a highlight, a book title,
  or how far through anything you are.
- There are no accounts, no passwords, and no secrets in the Worker. The sync
  code is the whole credential, which is why it is 125 bits of randomness.

Book files are never uploaded. The same book on two devices is matched by the
SHA-256 the app already computes when importing.

## Deploying

```bash
cd worker
npm install

# 1. Log in (opens a browser).
npx wrangler login

# 2. Create the database, then paste the printed database_id into wrangler.toml.
npm run db:create

# 3. Create the tables.
npm run db:init

# 4. Ship it. Wrangler prints the URL to paste into the app.
npm run deploy
```

Then in the app: **Library → the sync button → paste the URL → Start syncing**.
It shows a code; enter that code on the other device under *I have a code*.

Once you know your site's origin, narrow CORS in `wrangler.toml`:

```toml
[vars]
ALLOWED_ORIGINS = "https://yourname.github.io"
```

`npm run tail` streams live logs.

## API

`POST /v1/sync` — push and pull in one round trip.

```jsonc
// request
{ "account": "<64 hex chars>", "since": 12, "records": [
  { "id": "pos:<fingerprint>", "clientAt": 1699999999999, "payload": "<base64 ciphertext>" },
  { "id": "hl:<uuid>",         "clientAt": 1699999999999, "deleted": true }
]}
// response
{ "seq": 13, "cursor": 13, "more": false, "records": [ /* everything after `since` */ ] }
```

`POST /v1/forget` — `{ "account": "…" }` deletes everything stored under that
account. `GET /v1/health` — a liveness check the app uses to validate the URL
before saving it.

Writes are last-write-wins on `clientAt`, so a device that was offline for a
week cannot overwrite something newer when it reconnects. Pulls are driven by a
per-account sequence number rather than a clock, so no record is ever missed or
repeated.

Limits: 500 records and 2 MB per request, 64 KB per record, 1000 records per
pull.

## Local development

```bash
npm run db:init:local
npx wrangler dev
```
