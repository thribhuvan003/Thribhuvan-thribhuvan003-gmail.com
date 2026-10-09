import { readFileSync } from 'node:fs';

export function ensureChatSchema(db) {
  const columns = db.prepare('PRAGMA table_info(chat_messages)').all();
  // Preserve messages created by the first local version of chat.
  if (columns.length && !columns.some((column) => column.name === 'client_id')) {
    db.exec('ALTER TABLE chat_messages ADD COLUMN client_id TEXT');
  }
  db.exec(readFileSync(new URL('../db/chat.sql', import.meta.url), 'utf8'));
}

export function chatMessage(row) {
  return {
    seq: row.seq,
    id: row.id,
    clientId: row.client_id,
    body: row.body,
    createdAt: row.created_at,
    sender: { id: row.sender_id, name: row.sender_name },
  };
}
