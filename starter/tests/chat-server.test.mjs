import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import http from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';
import { openDatabase } from '../server/db.js';
import { issueAccessToken, signToken } from '../server/auth.js';
import { authenticate } from '../server/context.js';
import { createRouter } from '../server/router.js';
import { sendError } from '../server/http.js';
import { ensureChatSchema } from '../server/chat-store.js';
import { attachChatServer } from '../server/chat.js';
import { registerChatRoutes } from '../server/routes/chat.js';

const db = openDatabase(':memory:');
db.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
db.exec(readFileSync(new URL('../db/reference.sql', import.meta.url), 'utf8'));
ensureChatSchema(db);
const secret = 'isolated-chat-test';
for (const org of ['first', 'second']) {
  db.prepare('INSERT INTO organizations (id,name,theme) VALUES (?,?,?)').run(org, org, 'cobalt');
}
for (let index = 0; index < 60; index++) {
  const id = `user-${index}`;
  db.prepare('INSERT INTO users (id,email,name,password_hash) VALUES (?,?,?,?)')
    .run(id, `${id}@example.test`, `Teammate ${index}`, 'unused-test-hash');
  db.prepare('INSERT INTO memberships (id,org_id,user_id,role,status) VALUES (?,?,?,?,?)')
    .run(`member-${index}`, index === 59 ? 'second' : 'first', id, 'viewer', 'active');
}
const router = createRouter();
registerChatRoutes(router, { db });
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    const hit = router.match(req.method, url.pathname);
    assert.ok(hit);
    const ctx = { ...authenticate(db, secret)(req, hit.params), query: url.searchParams };
    hit.handler(ctx, hit.params, res);
  } catch (err) { sendError(res, err, 'chat-test'); }
});
const chat = attachChatServer(server, { db, secret });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const host = `127.0.0.1:${server.address().port}`;
const clients = new Set();
const token = (index) => issueAccessToken({ userId: `user-${index}`,
  orgId: index === 59 ? 'second' : 'first', role: 'viewer', permVersion: 1 }, secret);

class Client {
  constructor(accessToken, options = {}) {
    this.inbox = [];
    this.waiters = [];
    this.socket = new WebSocket(`ws://${host}/v1/chat/socket`, options);
    clients.add(this);
    this.closed = new Promise((resolve) => this.socket.once('close', (code) => {
      for (const waiter of this.waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error(`connection closed (${code})`));
      }
      resolve(code);
    }));
    this.socket.on('error', () => {});
    this.socket.on('message', (data) => {
      const packet = JSON.parse(data);
      const index = this.waiters.findIndex((waiter) => waiter.matches(packet));
      if (index < 0) this.inbox.push(packet);
      else {
        const [waiter] = this.waiters.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(packet);
      }
    });
    this.ready = this.wait((packet) => packet.type === 'ready');
    this.ready.catch(() => {});
    this.socket.once('open', () => this.socket.send(JSON.stringify({ type: 'authenticate', token: accessToken })));
  }
  wait(matches, timeout = 3000) {
    const found = this.inbox.findIndex(matches);
    if (found >= 0) return Promise.resolve(this.inbox.splice(found, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { matches, resolve, reject };
      waiter.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((item) => item !== waiter);
        reject(new Error('chat event timed out'));
      }, timeout);
      this.waiters.push(waiter);
    });
  }
  send(body, clientId = crypto.randomUUID()) {
    this.socket.send(JSON.stringify({ type: 'message', body, clientId }));
    return clientId;
  }
  packet(value) { this.socket.send(JSON.stringify(value)); }
  async close() { this.socket.close(); await this.closed; clients.delete(this); }
}

async function history(index, query = '', org = index === 59 ? 'second' : 'first') {
  const response = await fetch(`http://${host}/v1/orgs/${org}/chat/messages${query}`, {
    headers: { authorization: `Bearer ${token(index)}` },
  });
  return { status: response.status, ...await response.json() };
}

after(async () => {
  for (const client of clients) client.socket.terminate();
  chat.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  db.close();
});

test('adding chat to an existing database preserves old message history', () => {
  const legacy = openDatabase(':memory:');
  legacy.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  legacy.exec(`CREATE TABLE chat_messages (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE, org_id TEXT,
    sender_id TEXT, body TEXT, created_at TEXT
  ) STRICT;
  INSERT INTO chat_messages (id,org_id,sender_id,body,created_at)
    VALUES ('old-message','first','user-0','Keep this message','2026-10-01T00:00:00.000Z');`);
  ensureChatSchema(legacy);
  ensureChatSchema(legacy);
  assert.equal(legacy.prepare('SELECT body FROM chat_messages').get().body, 'Keep this message');
  assert.ok(legacy.prepare('PRAGMA table_info(chat_messages)').all().some((column) => column.name === 'client_id'));
  legacy.close();
});

test('messages persist before acknowledgement, retries do not duplicate, tenants remain isolated', async () => {
  const sender = new Client(token(0));
  const peer = new Client(token(1));
  const outsider = new Client(token(59));
  await Promise.all([sender.ready, peer.ready, outsider.ready]);
  const clientId = crypto.randomUUID();
  const ack = sender.wait((packet) => packet.type === 'ack' && packet.clientId === clientId);
  const delivery = peer.wait((packet) => packet.type === 'message' && packet.message.clientId === clientId);
  sender.send('A workstation handoff', clientId);
  const [saved, seen] = await Promise.all([ack, delivery]);
  assert.equal(saved.message.id, seen.message.id);
  assert.equal(db.prepare('SELECT count(*) AS n FROM chat_messages WHERE client_id = ?').get(clientId).n, 1);
  const repeated = sender.wait((packet) => packet.type === 'ack' && packet.clientId === clientId);
  sender.send('A workstation handoff', clientId);
  assert.equal((await repeated).message.id, saved.message.id);
  assert.equal(db.prepare('SELECT count(*) AS n FROM chat_messages WHERE client_id = ?').get(clientId).n, 1);
  const conflict = sender.wait((packet) => packet.type === 'error' && packet.code === 'CONFLICT');
  sender.send('A different message', clientId);
  await conflict;
  assert.equal((await history(59)).messages.length, 0);
  assert.equal((await history(0, '', 'second')).status, 404);
  assert.ok(!outsider.inbox.some((packet) => packet.type === 'message'));
  await Promise.all([sender.close(), peer.close(), outsider.close()]);
});

test('history catch-up pages preserve ordering without gaps or duplicate messages', async () => {
  const write = db.prepare(`INSERT INTO chat_messages (id,org_id,sender_id,body) VALUES (?,'first','user-2',?)`);
  const boundary = db.prepare('SELECT max(seq) AS seq FROM chat_messages').get().seq;
  db.transaction(() => {
    for (let index = 0; index < 235; index++) write.run(`replay-${index}`, `Missed update ${index}`);
  })();
  const recovered = [];
  let after = boundary;
  do {
    const page = await history(2, `?after=${after}&limit=100`);
    assert.equal(page.status, 200);
    recovered.push(...page.messages);
    after = page.nextCursor;
  } while (after !== null);
  assert.equal(recovered.length, 235);
  assert.equal(new Set(recovered.map((message) => message.id)).size, 235);
  assert.ok(recovered.every((message, index) => !index || message.seq > recovered[index - 1].seq));
  const last = await history(2, '?limit=10');
  assert.equal(last.messages.length, 10);
  assert.ok(last.nextCursor);
  assert.equal((await history(2, '?after=1&before=5')).status, 400);
});

test('invalid tokens, expired tokens, malformed frames and hostile origins are rejected', async () => {
  const invalid = new Client('invalid');
  assert.equal(await invalid.closed, 4401);
  const claims = { iss: 'remoteops', aud: 'remoteops-api', sub: 'user-3', org: 'first', pv: 1,
    jti: 'test', exp: Math.floor(Date.now() / 1000) - 1 };
  const expired = new Client(signToken(claims, secret));
  assert.equal(await expired.closed, 4401);
  const hostile = new Client(token(3), { origin: 'https://attacker.example' });
  await hostile.closed;
  assert.notEqual(hostile.socket.readyState, WebSocket.OPEN);
  const valid = new Client(token(3));
  await valid.ready;
  const oversized = valid.wait((packet) => packet.type === 'error' && packet.code === 'VALIDATION');
  valid.send('x'.repeat(2001));
  await oversized;
  const malformed = valid.wait((packet) => packet.type === 'error');
  valid.socket.send('not json');
  await malformed;
  await valid.close();
});

test('changing membership blocks delivery to an already-open socket', async () => {
  const member = new Client(token(4));
  const sender = new Client(token(5));
  await Promise.all([member.ready, sender.ready]);
  db.prepare("UPDATE memberships SET status = 'suspended' WHERE user_id = 'user-4'").run();
  const ack = sender.wait((packet) => packet.type === 'ack');
  sender.send('Private update after suspension');
  await ack;
  assert.equal(await member.closed, 4401);
  assert.ok(!member.inbox.some((packet) => packet.type === 'message'));
  await sender.close();
});

test('video signalling stays inside the organization and limits browser-to-browser calls', async () => {
  const room = Array.from({ length: 7 }, (_, index) => new Client(token(10 + index)));
  const outsider = new Client(token(59));
  const ready = await Promise.all([...room.map((client) => client.ready), outsider.ready]);
  for (let index = 0; index < 6; index++) room[index].packet({ type: 'call_join' });
  await room[0].wait((packet) => packet.type === 'call_presence' && packet.participants.length === 6);
  const full = room[6].wait((packet) => packet.type === 'error' && packet.code === 'CALL_FULL');
  room[6].packet({ type: 'call_join' });
  await full;
  const relayed = room[1].wait((packet) => packet.type === 'rtc_signal' &&
    packet.fromPeerId === ready[0].peerId);
  room[0].packet({ type: 'rtc_signal', targetPeerId: ready[1].peerId,
    signal: { type: 'offer', sdp: 'test offer' } });
  assert.equal((await relayed).signal.sdp, 'test offer');
  outsider.packet({ type: 'call_join' });
  const isolated = outsider.wait((packet) => packet.type === 'error' && packet.code === 'PEER_LEFT');
  outsider.packet({ type: 'rtc_signal', targetPeerId: ready[1].peerId,
    signal: { type: 'offer', sdp: 'cross-org offer' } });
  await isolated;
  assert.ok(!room[1].inbox.some((packet) => packet.signal?.sdp === 'cross-org offer'));
  await Promise.all([...room.map((client) => client.close()), outsider.close()]);
});

test('per-user rate limits hold across tabs and reconnects', async () => {
  const first = new Client(token(6));
  const second = new Client(token(6));
  await Promise.all([first.ready, second.ready]);
  const limited = second.wait((packet) => packet.type === 'error' && packet.code === 'RATE_LIMITED');
  for (let index = 0; index < 20; index++) {
    const client = index % 2 ? first : second;
    const ack = client.wait((packet) => packet.type === 'ack');
    client.send(`Rate test ${index}`);
    await ack;
  }
  second.send('Over the limit');
  await limited;
  await Promise.all([first.close(), second.close()]);
  const rejoined = new Client(token(6));
  await rejoined.ready;
  const blocked = rejoined.wait((packet) => packet.type === 'error' && packet.code === 'RATE_LIMITED');
  rejoined.send('Reconnecting does not reset the rate limit');
  await blocked;
  await rejoined.close();
});

test('100 live connections across 50 users receive every message in the same order', async () => {
  const crowd = Array.from({ length: 100 }, (_, index) => new Client(token(7 + index % 50)));
  await Promise.all(crowd.map((client) => client.ready));
  const ordered = crowd.map(() => []);
  const timings = [];
  for (let round = 0; round < 10; round++) {
    const clientId = crypto.randomUUID();
    const reads = crowd.map((client, index) => client.wait((packet) =>
      packet.type === 'message' && packet.message.clientId === clientId).then((packet) => {
      ordered[index].push(packet.message.seq);
    }));
    const start = performance.now();
    crowd[round].send(`Concurrent update ${round}`, clientId);
    await Promise.all(reads);
    timings.push(performance.now() - start);
  }
  for (const sequence of ordered) assert.deepEqual(sequence, ordered[0]);
  timings.sort((a, b) => a - b);
  console.log(`Local send-to-all, 100 sockets: median ${timings[5].toFixed(1)} ms, max ${timings[9].toFixed(1)} ms`);
  await Promise.all(crowd.map((client) => client.close()));
});
