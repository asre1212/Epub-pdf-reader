-- One row per synced record. The server never learns what any of them say:
-- `payload` is AES-GCM ciphertext produced on the device, and `account` is a
-- hash derived from the sync code, which is never transmitted.
CREATE TABLE IF NOT EXISTS records (
  account    TEXT    NOT NULL,
  id         TEXT    NOT NULL,          -- "pos:<book fingerprint>" or "hl:<uuid>"
  seq        INTEGER NOT NULL,          -- server-assigned, the pull cursor
  client_at  INTEGER NOT NULL,          -- device clock, decides last-write-wins
  deleted    INTEGER NOT NULL DEFAULT 0,
  payload    TEXT,                      -- base64 ciphertext, null once deleted
  PRIMARY KEY (account, id)
);

-- Pulls are "everything after this cursor", so this index is the hot path.
CREATE INDEX IF NOT EXISTS records_by_seq ON records (account, seq);

-- A per-account counter, so cursors never depend on clocks agreeing.
CREATE TABLE IF NOT EXISTS accounts (
  account    TEXT    PRIMARY KEY,
  seq        INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
