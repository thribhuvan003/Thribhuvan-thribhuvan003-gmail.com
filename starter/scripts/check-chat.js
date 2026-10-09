import { WebSocket } from 'ws';

const HTTP = 'http://127.0.0.1:8080/v1';
const SOCKET = 'ws://127.0.0.1:8080/v1/chat/socket';
let passed = 0;
let failed = 0;

function check(condition, label) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${label}`);
  }
}

async function request(path, { method = 'GET', token, body, expected = 200 } = {}) {
  const response = await fetch(`${HTTP}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (response.status !== expected) {
    throw new Error(`${method} ${path}: expected ${expected}, got ${response.status} (${data.error?.message})`);
  }
  return data;
}

async function tokenFor(email, orgId) {
  const login = await request('/auth/login', {
    method: 'POST', body: { email, password: 'demo1234' },
  });
  if (!orgId || login.orgId === orgId) return login;
  return request('/auth/token', {
    method: 'POST', token: login.token, body: { orgId },
  });
}

class ChatClient {
  constructor(token) {
    this.socket = new WebSocket(SOCKET);
    this.inbox = [];
    this.waiters = [];
    this.closed = new Promise((resolve) => {
      this.socket.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    });
    this.socket.on('message', (raw) => {
      const packet = JSON.parse(raw.toString());
      const waiter = this.waiters.find((candidate) => candidate.predicate(packet));
      if (waiter) {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        clearTimeout(waiter.timer);
        waiter.resolve(packet);
      } else {
        this.inbox.push(packet);
      }
    });
    this.ready = new Promise((resolve, reject) => {
      this.socket.once('open', () => {
        this.socket.send(JSON.stringify({ type: 'authenticate', token }));
        this.waitFor((packet) => packet.type === 'ready').then(resolve, reject);
      });
      this.socket.once('error', reject);
    });
  }

  waitFor(predicate, timeout = 2_000) {
    const found = this.inbox.findIndex(predicate);
    if (found >= 0) return Promise.resolve(this.inbox.splice(found, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        const at = this.waiters.indexOf(waiter);
        if (at >= 0) this.waiters.splice(at, 1);
        reject(new Error('timed out waiting for chat event'));
      }, timeout);
      this.waiters.push(waiter);
    });
  }

  send(body) {
    this.socket.send(JSON.stringify({ type: 'message', body, clientId: crypto.randomUUID() }));
  }

  close() {
    this.socket.close();
  }
}

console.log('\n== authenticated real-time delivery and tenant isolation ==');
const dana = await tokenFor('dana@example.test');
const acmeId = dana.orgId;
const sam = await tokenFor('sam@example.test', acmeId);
const globex = await tokenFor('owner@globex.test');
const a = new ChatClient(dana.token);
const b = new ChatClient(sam.token);
const otherOrg = new ChatClient(globex.token);
await Promise.all([a.ready, b.ready, otherOrg.ready]);

const unique = `isolation-${Date.now()}`;
const receivedBySender = a.waitFor((packet) => packet.type === 'message' && packet.message.body === unique);
const receivedByPeer = b.waitFor((packet) => packet.type === 'message' && packet.message.body === unique);
const leaked = otherOrg.waitFor((packet) => packet.type === 'message' && packet.message.body === unique, 400)
  .then(() => true, () => false);
a.send(unique);
const [senderPacket, peerPacket, crossedOrg] = await Promise.all([receivedBySender, receivedByPeer, leaked]);
check(senderPacket.message.id === peerPacket.message.id, 'both members receive the same stored message');
check(!crossedOrg, 'a different organization receives nothing');

const acmeHistory = await request(`/orgs/${acmeId}/chat/messages`, { token: dana.token });
const globexHistory = await request(`/orgs/${globex.orgId}/chat/messages`, { token: globex.token });
check(acmeHistory.messages.some((message) => message.body === unique), 'message is persisted in its organization');
check(!globexHistory.messages.some((message) => message.body === unique), 'history is isolated by organization');
await request(`/orgs/${globex.orgId}/chat/messages`, { token: dana.token, expected: 404 });
check(true, 'cross-organization history is indistinguishable from missing');

console.log('\n== connection and input controls ==');
const invalid = new ChatClient('not-a-token');
invalid.ready.catch(() => {});
const invalidClose = await invalid.closed;
check(invalidClose.code === 4401, 'invalid token is rejected');

const validation = a.waitFor((packet) => packet.type === 'error' && packet.code === 'VALIDATION');
a.send('x'.repeat(2_001));
await validation;
check(true, 'oversized message is rejected');

console.log('\n== concurrent connections ==');
const identities = await Promise.all([
  tokenFor('dana@example.test', acmeId),
  tokenFor('sam@example.test', acmeId),
  tokenFor('owner@acme.test', acmeId),
  tokenFor('admin@acme.test', acmeId),
  tokenFor('viewer@acme.test', acmeId),
]);
const crowd = Array.from({ length: 25 }, (_, index) =>
  new ChatClient(identities[index % identities.length].token));
await Promise.all(crowd.map((client) => client.ready));
const concurrentBody = `concurrent-${Date.now()}`;
const deliveries = crowd.map((client) =>
  client.waitFor((packet) => packet.type === 'message' && packet.message.body === concurrentBody));
crowd[0].send(concurrentBody);
await Promise.all(deliveries);
check(true, 'one message reaches 25 simultaneous connections across 5 users');
crowd.forEach((client) => client.close());

const rateA = new ChatClient(dana.token);
const rateB = new ChatClient(dana.token);
await Promise.all([rateA.ready, rateB.ready]);
const rateLimited = Promise.any([
  rateA.waitFor((packet) => packet.type === 'error' && packet.code === 'RATE_LIMITED'),
  rateB.waitFor((packet) => packet.type === 'error' && packet.code === 'RATE_LIMITED'),
]);
for (let index = 0; index < 11; index += 1) {
  rateA.send(`rate-a-${index}`);
  rateB.send(`rate-b-${index}`);
}
await rateLimited;
check(true, 'rate limit follows the user across multiple connections');
rateA.close();
rateB.close();

console.log('\n== membership changes close live access ==');
const admin = identities[3];
const viewer = identities[4];
const members = await request(`/orgs/${acmeId}/members`, { token: admin.token });
const viewerId = members.members.find((member) => member.email === 'viewer@acme.test').id;
const victim = new ChatClient(viewer.token);
await victim.ready;
const victimClosed = victim.closed;
await request(`/orgs/${acmeId}/members/${viewerId}/suspend`, {
  method: 'POST', token: admin.token, body: {},
});
const closed = await Promise.race([
  victimClosed,
  new Promise((_, reject) => setTimeout(() => reject(new Error('suspended socket stayed open')), 2_000)),
]);
check(closed.code === 4401, 'suspended member is disconnected immediately');
await request(`/orgs/${acmeId}/members/${viewerId}/suspend`, {
  method: 'DELETE', token: admin.token,
});

[a, b, otherOrg].forEach((client) => client.close());
console.log(`\n${failed ? 'FAIL' : 'ALL PASS'} — ${passed} passed, ${failed} failed\n`);
if (failed) process.exitCode = 1;
