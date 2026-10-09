import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { once } from 'node:events';
import { openDatabase } from '../server/db.js';

test('live startup creates only the private owner and preserves the database on restart', async () => {
  const root = resolve('data');
  mkdirSync(root, { recursive: true });
  const folder = mkdtempSync(join(root, 'live-smoke-'));
  assert.ok(!relative(root, folder).startsWith('..'));
  const file = join(folder, 'app.db');
  const env = { ...process.env, DATABASE_FILE: file, PORT: '8138',
    JWT_SECRET: crypto.randomUUID(), APP_HASH_KEY: crypto.randomUUID(),
    OWNER_EMAIL: 'owner@private.invalid', OWNER_NAME: 'Private Owner',
    OWNER_PASSWORD: crypto.randomUUID(), COMPANY_NAME: 'Private Studio' };

  async function boot() {
    const child = spawn(process.execPath, ['scripts/start-live.js'], { env, windowsHide: true });
    child.stderr.setEncoding('utf8');
    child.stdout.setEncoding('utf8');
    let errors = '';
    child.stderr.on('data', (chunk) => { errors += chunk; });
    await new Promise((resolveReady, reject) => {
      const timeout = setTimeout(() => { child.kill(); reject(new Error('live startup timed out')); }, 10000);
      child.stdout.on('data', (text) => {
        if (text.includes('RemoteOps on')) { clearTimeout(timeout); resolveReady(); }
      });
      child.on('exit', (code) => { clearTimeout(timeout); if (code) reject(new Error(errors)); });
      child.on('error', reject);
    });
    return child;
  }
  async function stop(child) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
  let child;
  try {
    child = await boot();
    const response = await fetch('http://127.0.0.1:8138/v1/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: env.OWNER_EMAIL, password: env.OWNER_PASSWORD }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).orgs[0].name, 'Private Studio');
    await stop(child); child = null;
    const db = openDatabase(file);
    assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n, 1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM memberships').get().n, 1);
    db.close();
    delete env.OWNER_PASSWORD;
    child = await boot();
    await stop(child); child = null;
    const existing = openDatabase(file);
    assert.equal(existing.prepare('SELECT count(*) AS n FROM users').get().n, 1);
    existing.close();
  } finally {
    if (child) await stop(child);
    for (const suffix of ['', '-wal', '-shm']) {
      try { unlinkSync(file + suffix); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    rmdirSync(folder);
  }
});
