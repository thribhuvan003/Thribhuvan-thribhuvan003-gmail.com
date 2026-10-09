BEGIN;

-- One organisation-wide room for the first chat version. A message always
-- carries its organisation so history queries cannot cross tenant boundaries.
CREATE TABLE IF NOT EXISTS chat_messages (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  id         TEXT NOT NULL UNIQUE,
  org_id     TEXT NOT NULL REFERENCES organizations(id),
  sender_id  TEXT NOT NULL REFERENCES users(id),
  client_id  TEXT,
  body       TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE INDEX IF NOT EXISTS chat_messages_by_org
  ON chat_messages (org_id, seq DESC);

CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_by_client
  ON chat_messages (org_id, sender_id, client_id) WHERE client_id IS NOT NULL;

COMMIT;
