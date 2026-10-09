import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { openDatabase, newId } from '../server/db.js';
import { hashPassword } from '../server/auth.js';
import { ensureChatSchema } from '../server/chat-store.js';

for (const name of ['JWT_SECRET', 'APP_HASH_KEY']) {
  if (!process.env[name] || process.env[name].length < 32) {
    throw new Error(`${name} must be set to a secret of at least 32 characters.`);
  }
}
process.env.NODE_ENV = 'production';
const file = process.env.DATABASE_FILE ?? 'data/app.db';
process.env.DATABASE_FILE = file;
mkdirSync(dirname(file), { recursive: true });
const db = openDatabase(file);
const ready = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
if (!ready) {
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const name = process.env.OWNER_NAME?.trim();
  const password = process.env.OWNER_PASSWORD;
  const company = process.env.COMPANY_NAME?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name || !company ||
      !password || password.length < 16) {
    throw new Error('Set OWNER_EMAIL, OWNER_NAME, COMPANY_NAME and an OWNER_PASSWORD of at least 16 characters for first startup.');
  }
  db.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../db/reference.sql', import.meta.url), 'utf8'));
  const userId = newId('usr');
  const orgId = newId('org');
  db.transaction(() => {
    db.prepare('INSERT INTO users (id,email,name,password_hash) VALUES (?,?,?,?)')
      .run(userId, email, name, hashPassword(password));
    db.prepare('INSERT INTO organizations (id,name,theme) VALUES (?,?,?)').run(orgId, company, 'cobalt');
    db.prepare(`INSERT INTO memberships (id,org_id,user_id,role,status)
      VALUES (?,?,?,'owner','active')`).run(newId('mem'), orgId, userId);
  })();
  console.log('Private workspace initialized. Invite teammates from People.');
}
if (db.prepare("SELECT 1 FROM users WHERE id IN ('usr_dana', 'usr_sam')").get()) {
  throw new Error('Live startup refuses the public demo fixture. Use a separate database file.');
}
ensureChatSchema(db);
db.close();
await import('../server/index.js');
