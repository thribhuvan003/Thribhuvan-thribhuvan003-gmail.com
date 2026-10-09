import { useCallback, useEffect, useRef, useState } from 'react';

function merge(current, incoming) {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

export function useChat({ session, authed, onAuthExpired, onIncoming }) {
  const [messages, setMessages] = useState([]);
  const [pending, setPending] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [status, setStatus] = useState('connecting');
  const [users, setUsers] = useState([]);
  const [peerId, setPeerId] = useState(null);
  const [iceServers, setIceServers] = useState([]);
  const [callParticipants, setCallParticipants] = useState([]);
  const [error, setError] = useState(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const socketRef = useRef(null);
  const checkpoint = useRef(0);
  const generation = useRef(0);
  const outbox = useRef(new Map());
  const received = useRef(new Set());
  const callbacks = useRef({ authed, onAuthExpired, onIncoming });
  const callListeners = useRef(new Set());
  callbacks.current = { authed, onAuthExpired, onIncoming };

  const sendPacket = useCallback((packet) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) return false;
    socketRef.current.send(JSON.stringify(packet));
    return true;
  }, []);
  const onCallPacket = useCallback((listener) => {
    callListeners.current.add(listener);
    return () => callListeners.current.delete(listener);
  }, []);

  function showOutbox() { setPending([...outbox.current.values()].map(({ timer, ...item }) => item)); }
  function receive(incoming, notify = false) {
    for (const message of incoming) {
      if (notify && !received.current.has(message.id) && message.sender.id !== session.user.id) {
        callbacks.current.onIncoming?.();
      }
      received.current.add(message.id);
      checkpoint.current = Math.max(checkpoint.current, message.seq);
      if (message.sender.id === session.user.id && outbox.current.has(message.clientId)) {
        clearTimeout(outbox.current.get(message.clientId).timer);
        outbox.current.delete(message.clientId);
      }
    }
    setMessages((current) => merge(current, incoming));
    showOutbox();
  }

  function transmit(item) {
    if (socketRef.current?.readyState !== WebSocket.OPEN) return;
    item.state = 'sending';
    clearTimeout(item.timer);
    item.timer = setTimeout(() => {
      if (outbox.current.has(item.clientId)) {
        item.state = 'failed';
        showOutbox();
      }
    }, 8_000);
    socketRef.current.send(JSON.stringify({ type: 'message', body: item.body, clientId: item.clientId }));
    showOutbox();
  }

  useEffect(() => {
    const run = ++generation.current;
    let stopped = false;
    let retryTimer;
    let authTimer;
    let attempts = 0;
    const active = () => !stopped && generation.current === run;
    setStatus('connecting');
    setUsers([]);
    setPeerId(null);
    setCallParticipants([]);
    setLoadingOlder(false);

    async function recover() {
      let after = checkpoint.current;
      const initial = after === 0;
      do {
        const query = initial ? '' : `?after=${after}&limit=100`;
        const page = await callbacks.current.authed(
          `/orgs/${encodeURIComponent(session.orgId)}/chat/messages${query}`);
        if (!active()) return;
        receive(page.messages, !initial);
        if (initial) { setCursor(page.nextCursor); break; }
        after = page.nextCursor;
      } while (after !== null);
    }

    function reconnect() {
      if (!active()) return;
      setStatus('reconnecting');
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, Math.min(500 * 2 ** attempts++, 10_000));
    }

    function connect() {
      if (!active()) return;
      const url = new URL('/v1/chat/socket', window.location.href);
      url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(url);
      socketRef.current = socket;
      const current = () => active() && socketRef.current === socket;
      authTimer = setTimeout(() => { if (current()) socket.close(); }, 7_000);
      socket.onopen = () => {
        if (current()) socket.send(JSON.stringify({ type: 'authenticate', token: session.token }));
      };
      socket.onmessage = async (event) => {
        if (!current()) return;
        let packet;
        try { packet = JSON.parse(event.data); } catch { return; }
        if (packet.type === 'ready') {
          clearTimeout(authTimer);
          setUsers(packet.users);
          setPeerId(packet.peerId);
          setIceServers(Array.isArray(packet.iceServers) ? packet.iceServers : []);
          setCallParticipants(Array.isArray(packet.callParticipants) ? packet.callParticipants : []);
          setStatus('syncing');
          try {
            // Subscribe first, then load history: messages sent during the request
            // arrive over the socket and merge by their database identifier.
            await recover();
            if (!current()) return;
            setStatus('connected');
            setError(null);
            attempts = 0;
            for (const item of outbox.current.values()) {
              if (item.state === 'sending') transmit(item);
            }
          } catch (err) {
            if (current()) { setError(err.message); socket.close(); }
          }
        } else if (packet.type === 'presence') {
          setUsers(packet.users);
        } else if (packet.type === 'call_presence') {
          setCallParticipants(packet.participants);
        } else if (packet.type === 'rtc_signal') {
          for (const listener of callListeners.current) listener(packet);
        } else if (packet.type === 'message' || packet.type === 'ack') {
          receive([packet.message], packet.type === 'message');
        } else if (packet.type === 'error') {
          const item = outbox.current.get(packet.clientId);
          if (item) { clearTimeout(item.timer); item.state = 'failed'; showOutbox(); }
          if (['CALL_FULL', 'CALL_ALREADY_JOINED', 'PEER_LEFT'].includes(packet.code)) {
            for (const listener of callListeners.current) listener(packet);
          }
          setError(packet.message);
        }
      };
      socket.onclose = async (event) => {
        if (!current()) return;
        clearTimeout(authTimer);
        setUsers([]);
        setPeerId(null);
        setCallParticipants([]);
        if (event.code === 4409 || event.code === 1008) {
          setStatus('offline');
          setError('Chat connection limit reached. Close extra tabs and reload.');
          return;
        }
        if (event.code === 4401) {
          setStatus('reconnecting');
          try { await callbacks.current.onAuthExpired(); }
          catch (err) { if (active()) { setError(err.message); reconnect(); } }
        } else reconnect();
      };
      socket.onerror = () => {}; // Close handles network failure and recovery.
    }

    function wake() {
      if (document.visibilityState !== 'hidden' && socketRef.current?.readyState === WebSocket.CLOSED) {
        clearTimeout(retryTimer);
        connect();
      }
    }
    connect();
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      clearTimeout(authTimer);
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket?.readyState === WebSocket.CONNECTING) socket.onopen = () => socket.close();
      else socket?.close();
    };
  }, [session.orgId, session.token]);

  useEffect(() => () => {
    for (const item of outbox.current.values()) clearTimeout(item.timer);
  }, []);

  async function loadOlder() {
    if (!cursor || loadingOlder) return;
    const run = generation.current;
    setLoadingOlder(true);
    try {
      const page = await callbacks.current.authed(
        `/orgs/${encodeURIComponent(session.orgId)}/chat/messages?before=${cursor}`);
      if (run !== generation.current) return false;
      receive(page.messages);
      setCursor(page.nextCursor);
      return true;
    } catch (err) {
      if (run === generation.current) setError(err.message);
      return false;
    }
    finally { if (run === generation.current) setLoadingOlder(false); }
  }

  function send(body) {
    body = body.trim();
    if (!body || body.length > 2000 || status !== 'connected' ||
        socketRef.current?.readyState !== WebSocket.OPEN) return false;
    const item = { clientId: crypto.randomUUID(), body, createdAt: new Date().toISOString(), state: 'sending' };
    outbox.current.set(item.clientId, item);
    setError(null);
    transmit(item);
    return true;
  }
  function retry(clientId) {
    const item = outbox.current.get(clientId);
    if (item && status === 'connected') { setError(null); transmit(item); }
  }

  return { messages, pending, cursor, status, users, peerId, iceServers, callParticipants,
    error, loadingOlder, loadOlder, send, retry, sendPacket, onCallPacket };
}
