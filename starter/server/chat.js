import { WebSocket, WebSocketServer } from 'ws';
import { contextFromToken } from './context.js';
import { newId, nowIso } from './db.js';
import { chatMessage } from './chat-store.js';
import { HttpError } from './http.js';

const CHECK_INTERVAL_MS = 10_000;
const RATE_WINDOW_MS = 10_000;
const RATE_LIMIT = 20;
const MAX_BUFFER = 256 * 1024;
const MAX_CONNECTIONS = 500;
const MAX_USER_CONNECTIONS = 10;
const MAX_CALL_PARTICIPANTS = 6;

function iceServers() {
  if (!process.env.WEBRTC_ICE_SERVERS) {
    return [{ urls: 'stun:stun.cloudflare.com:3478' }];
  }
  let parsed;
  try { parsed = JSON.parse(process.env.WEBRTC_ICE_SERVERS); }
  catch { throw new Error('WEBRTC_ICE_SERVERS must be valid JSON.'); }
  if (!Array.isArray(parsed) || !parsed.length || parsed.length > 5 || parsed.some((item) =>
    !item || typeof item !== 'object' || Array.isArray(item) ||
    !(typeof item.urls === 'string' || Array.isArray(item.urls)))) {
    throw new Error('WEBRTC_ICE_SERVERS must be an array of ICE server objects.');
  }
  return parsed;
}

export function attachChatServer(server, { db, secret }) {
  const callIceServers = iceServers();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
  const byOrg = new Map();
  const rates = new Map();
  const select = `SELECT m.*, u.name AS sender_name FROM chat_messages m
    JOIN users u ON u.id = m.sender_id`;
  const existing = db.prepare(`${select} WHERE m.org_id = ? AND m.sender_id = ? AND m.client_id = ?`);
  const inserted = db.prepare(`${select} WHERE m.id = ?`);
  const insert = db.prepare(`INSERT INTO chat_messages
    (id, org_id, sender_id, client_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)`);

  function send(socket, packet) {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > MAX_BUFFER) return socket.terminate();
    socket.send(JSON.stringify(packet));
  }

  function remove(socket) {
    const orgId = socket.chat?.orgId;
    if (!orgId) return null;
    const group = byOrg.get(orgId);
    group?.delete(socket);
    if (!group?.size) byOrg.delete(orgId);
    socket.chat = null;
    return orgId;
  }

  function closeAccess(socket) {
    const orgId = remove(socket);
    if (socket.readyState === WebSocket.OPEN) socket.close(4401, 'access expired or changed');
    return orgId;
  }

  function checkAccess(socket) {
    return contextFromToken(db, secret, socket.chat.token);
  }

  function presence(orgId) {
    const unique = new Map();
    for (const socket of byOrg.get(orgId) ?? []) {
      if (socket.readyState === WebSocket.OPEN && socket.chat) {
        unique.set(socket.chat.userId, { id: socket.chat.userId, name: socket.chat.name });
      }
    }
    const users = [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
    return { type: 'presence', online: users.length, users };
  }

  function broadcastPresence(orgId) {
    const packet = presence(orgId);
    for (const socket of byOrg.get(orgId) ?? []) send(socket, packet);
  }

  function callPresence(orgId) {
    const participants = [];
    for (const socket of byOrg.get(orgId) ?? []) {
      if (socket.readyState === WebSocket.OPEN && socket.chat?.inCall) {
        participants.push({ peerId: socket.chat.peerId, userId: socket.chat.userId,
          name: socket.chat.name });
      }
    }
    participants.sort((a, b) => a.name.localeCompare(b.name) || a.peerId.localeCompare(b.peerId));
    return { type: 'call_presence', participants, limit: MAX_CALL_PARTICIPANTS };
  }

  function broadcastCallPresence(orgId) {
    const packet = callPresence(orgId);
    for (const socket of byOrg.get(orgId) ?? []) send(socket, packet);
  }

  function broadcastState(orgId) {
    broadcastPresence(orgId);
    broadcastCallPresence(orgId);
  }

  function broadcastMessage(orgId, message) {
    let changed = false;
    // Membership can change while a socket is open. Recheck before disclosing data.
    for (const socket of byOrg.get(orgId) ?? []) {
      try { checkAccess(socket); }
      catch { closeAccess(socket); changed = true; continue; }
      send(socket, { type: 'message', message });
    }
    if (changed) broadcastState(orgId);
  }

  function authenticate(socket, token) {
    const ctx = contextFromToken(db, secret, token);
    const group = byOrg.get(ctx.orgId) ?? new Set();
    const own = [...group].filter((client) => client.chat?.userId === ctx.userId);
    if (own.length >= MAX_USER_CONNECTIONS) {
      socket.close(4409, 'too many chat connections');
      return;
    }
    const user = db.prepare('SELECT name FROM users WHERE id = ?').get(ctx.userId);
    socket.chat = { userId: ctx.userId, orgId: ctx.orgId, name: user.name, token,
      peerId: newId('peer'), inCall: false };
    group.add(socket);
    byOrg.set(ctx.orgId, group);
    send(socket, { ...presence(ctx.orgId), type: 'ready', userId: ctx.userId,
      peerId: socket.chat.peerId, iceServers: callIceServers,
      callParticipants: callPresence(ctx.orgId).participants });
    broadcastState(ctx.orgId);
  }

  function reject(socket, payload, code, message) {
    send(socket, { type: 'error', clientId: typeof payload?.clientId === 'string' ?
      payload.clientId.slice(0, 80) : null, code, message });
  }

  function acceptMessage(socket, payload) {
    checkAccess(socket);
    if (typeof payload.clientId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(payload.clientId)) {
      return reject(socket, payload, 'VALIDATION', 'A valid message identifier is required.');
    }
    const body = typeof payload.body === 'string' ? payload.body.trim() : '';
    if (!body || body.length > 2000 || body.includes('\u0000')) {
      return reject(socket, payload, 'VALIDATION', 'Messages must contain 1 to 2,000 characters.');
    }
    const prior = existing.get(socket.chat.orgId, socket.chat.userId, payload.clientId);
    if (prior) {
      if (prior.body !== body) return reject(socket, payload, 'CONFLICT', 'Message identifier already used.');
      return send(socket, { type: 'ack', clientId: payload.clientId, message: chatMessage(prior) });
    }
    const now = Date.now();
    const key = `${socket.chat.orgId}:${socket.chat.userId}`;
    const timestamps = (rates.get(key) ?? []).filter((time) => now - time < RATE_WINDOW_MS);
    if (timestamps.length >= RATE_LIMIT) {
      return reject(socket, payload, 'RATE_LIMITED', 'Too many messages. Wait a moment and retry.');
    }
    timestamps.push(now);
    rates.set(key, timestamps);
    const id = newId('msg');
    insert.run(id, socket.chat.orgId, socket.chat.userId, payload.clientId, body, nowIso());
    const message = chatMessage(inserted.get(id));
    // Acknowledgement follows the database commit, so a retry cannot create a duplicate.
    send(socket, { type: 'ack', clientId: payload.clientId, message });
    broadcastMessage(socket.chat.orgId, message);
  }

  function acceptCallOperation(socket, packet) {
    checkAccess(socket);
    if (packet.type === 'call_join') {
      const duplicate = [...(byOrg.get(socket.chat.orgId) ?? [])].some((client) =>
        client !== socket && client.chat?.inCall && client.chat.userId === socket.chat.userId);
      if (duplicate) return reject(socket, packet, 'CALL_ALREADY_JOINED',
        'You already joined this call in another tab.');
      if (!socket.chat.inCall && callPresence(socket.chat.orgId).participants.length >= MAX_CALL_PARTICIPANTS) {
        return reject(socket, packet, 'CALL_FULL', `Video calls support up to ${MAX_CALL_PARTICIPANTS} people.`);
      }
      socket.chat.inCall = true;
      broadcastCallPresence(socket.chat.orgId);
      return;
    }
    if (packet.type === 'call_leave') {
      socket.chat.inCall = false;
      broadcastCallPresence(socket.chat.orgId);
      return;
    }
    if (packet.type !== 'rtc_signal' || !socket.chat.inCall ||
        typeof packet.targetPeerId !== 'string' || packet.targetPeerId === socket.chat.peerId ||
        !packet.signal || typeof packet.signal !== 'object' || Array.isArray(packet.signal)) {
      return reject(socket, packet, 'VALIDATION', 'Invalid call operation.');
    }
    const signal = packet.signal;
    const description = ['offer', 'answer'].includes(signal.type) && typeof signal.sdp === 'string' &&
      signal.sdp.length <= 32_000;
    const candidate = signal.type === 'candidate' && signal.candidate &&
      typeof signal.candidate === 'object' && typeof signal.candidate.candidate === 'string' &&
      signal.candidate.candidate.length <= 4_000;
    const media = signal.type === 'media' && typeof signal.muted === 'boolean' && typeof signal.cameraOff === 'boolean';
    if (!description && !candidate && !media) return reject(socket, packet, 'VALIDATION', 'Invalid call signal.');
    const target = [...(byOrg.get(socket.chat.orgId) ?? [])].find((client) =>
      client.chat?.inCall && client.chat.peerId === packet.targetPeerId);
    if (!target) return reject(socket, packet, 'PEER_LEFT', 'That teammate has left the call.');
    send(target, { type: 'rtc_signal', fromPeerId: socket.chat.peerId,
      signal: media ? { type: 'media', muted: signal.muted, cameraOff: signal.cameraOff } : signal });
  }

  wss.on('connection', (socket) => {
    socket.isAlive = true;
    socket.chat = null;
    let attempts = 0;
    let windowStart = Date.now();
    const authTimer = setTimeout(() => closeAccess(socket), 5_000);
    socket.on('error', () => {}); // A failed peer must not crash the process.
    socket.on('pong', () => { socket.isAlive = true; });
    socket.on('message', (raw, binary) => {
      if (Date.now() - windowStart >= RATE_WINDOW_MS) { attempts = 0; windowStart = Date.now(); }
      if (++attempts > 100 || binary) { socket.close(1008, 'unsupported or excessive traffic'); return; }
      let packet;
      try { packet = JSON.parse(raw.toString()); }
      catch { reject(socket, null, 'VALIDATION', 'Invalid message.'); return; }
      if (!packet || typeof packet !== 'object' || Array.isArray(packet)) {
        return reject(socket, null, 'VALIDATION', 'Invalid message.');
      }
      if (!socket.chat) {
        if (packet.type !== 'authenticate' || typeof packet.token !== 'string') return closeAccess(socket);
        try { authenticate(socket, packet.token); clearTimeout(authTimer); }
        catch { closeAccess(socket); }
        return;
      }
      if (!['message', 'call_join', 'call_leave', 'rtc_signal'].includes(packet.type)) {
        return reject(socket, packet, 'VALIDATION', 'Unknown chat operation.');
      }
      try {
        if (packet.type === 'message') acceptMessage(socket, packet);
        else acceptCallOperation(socket, packet);
      }
      catch (err) {
        if (err instanceof HttpError) {
          const orgId = closeAccess(socket);
          if (orgId) broadcastPresence(orgId);
        } else {
          console.error('chat write failed:', err.message);
          reject(socket, packet, 'INTERNAL', 'Message could not be saved. Please retry.');
        }
      }
    });
    socket.on('close', () => {
      clearTimeout(authTimer);
      const orgId = remove(socket);
      if (orgId) broadcastState(orgId);
    });
  });

  server.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url, `http://${req.headers.host}`); }
    catch { socket.destroy(); return; }
    if (url.pathname !== '/v1/chat/socket') return;
    if (url.search || wss.clients.size >= MAX_CONNECTIONS) { socket.destroy(); return; }
    if (req.headers.origin) {
      try {
        const origin = new URL(req.headers.origin);
        if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host) {
          socket.destroy(); return;
        }
      } catch { socket.destroy(); return; }
    }
    wss.handleUpgrade(req, socket, head, (client) => wss.emit('connection', client, req));
  });

  const checker = setInterval(() => {
    const changed = new Set();
    for (const socket of wss.clients) {
      if (!socket.isAlive) { socket.terminate(); continue; }
      socket.isAlive = false;
      if (socket.chat) {
        try { checkAccess(socket); }
        catch { const orgId = closeAccess(socket); if (orgId) changed.add(orgId); continue; }
      }
      if (socket.readyState === WebSocket.OPEN) socket.ping();
    }
    for (const orgId of changed) broadcastState(orgId);
    for (const [key, times] of rates) {
      const active = times.filter((time) => Date.now() - time < RATE_WINDOW_MS);
      if (active.length) rates.set(key, active);
      else rates.delete(key);
    }
  }, CHECK_INTERVAL_MS);
  checker.unref();

  return {
    disconnectMember(orgId, userId) {
      for (const socket of byOrg.get(orgId) ?? []) {
        if (socket.chat?.userId === userId) closeAccess(socket);
      }
      broadcastState(orgId);
    },
    disconnectOrg(orgId) {
      for (const socket of byOrg.get(orgId) ?? []) closeAccess(socket);
    },
    close() {
      clearInterval(checker);
      for (const socket of wss.clients) socket.terminate();
      wss.close();
    },
  };
}
