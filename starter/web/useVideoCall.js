import { useCallback, useEffect, useRef, useState } from 'react';

export function useVideoCall({ chat }) {
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState(new Map());
  const [remoteMedia, setRemoteMedia] = useState(new Map());
  const [connections, setConnections] = useState(new Map());
  const [error, setError] = useState(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const joinedRef = useRef(false);
  const joinRequest = useRef(0);
  const joiningRef = useRef(false);
  const joinedPeer = useRef(null);
  const localRef = useRef(null);
  const peers = useRef(new Map());
  const candidates = useRef(new Map());
  const offered = useRef(new Set());
  const transport = useRef(chat);
  transport.current = chat;

  const dropPeer = useCallback((peerId) => {
    peers.current.get(peerId)?.close();
    peers.current.delete(peerId);
    candidates.current.delete(peerId);
    offered.current.delete(peerId);
    setConnections((current) => { const next = new Map(current); next.delete(peerId); return next; });
    setRemoteMedia((current) => {
      const next = new Map(current); next.delete(peerId); return next;
    });
    setRemoteStreams((current) => {
      if (!current.has(peerId)) return current;
      const next = new Map(current); next.delete(peerId); return next;
    });
  }, []);

  const dropAllPeers = useCallback(() => {
    for (const peerId of [...peers.current.keys()]) dropPeer(peerId);
    setRemoteMedia(new Map());
  }, [dropPeer]);

  function mediaState() {
    return { type: 'media', muted: !localRef.current?.getAudioTracks().some((track) => track.enabled),
      cameraOff: !localRef.current?.getVideoTracks().some((track) => track.enabled) };
  }

  const ensurePeer = useCallback((peerId) => {
    if (peers.current.has(peerId)) return peers.current.get(peerId);
    const peer = new RTCPeerConnection({ iceServers: transport.current.iceServers });
    for (const track of localRef.current?.getTracks() ?? []) peer.addTrack(track, localRef.current);
    peer.onicecandidate = (event) => {
      if (event.candidate) transport.current.sendPacket({ type: 'rtc_signal', targetPeerId: peerId,
        signal: { type: 'candidate', candidate: event.candidate.toJSON() } });
    };
    peer.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      setRemoteStreams((current) => new Map(current).set(peerId, stream));
    };
    peer.onconnectionstatechange = () => {
      if (peers.current.get(peerId) !== peer) return;
      setConnections((current) => new Map(current).set(peerId, peer.connectionState));
      if (peer.connectionState === 'failed') setError('The media connection failed. Leave and rejoin; if it happens again, the call relay needs checking.');
    };
    peers.current.set(peerId, peer);
    transport.current.sendPacket({ type: 'rtc_signal', targetPeerId: peerId, signal: mediaState() });
    return peer;
  }, []);

  const offerTo = useCallback(async (peerId) => {
    if (offered.current.has(peerId)) return;
    offered.current.add(peerId);
    try {
      const peer = ensurePeer(peerId);
      if (peer.signalingState !== 'stable') return;
      await peer.setLocalDescription(await peer.createOffer());
      transport.current.sendPacket({ type: 'rtc_signal', targetPeerId: peerId,
        signal: peer.localDescription.toJSON() });
    } catch {
      offered.current.delete(peerId);
      setError('The call could not connect. Try leaving and joining again.');
    }
  }, [ensurePeer]);

  const leave = useCallback(() => {
    joinRequest.current++;
    joiningRef.current = false;
    setJoining(false);
    if (joinedRef.current) transport.current.sendPacket({ type: 'call_leave' });
    joinedRef.current = false;
    joinedPeer.current = null;
    setJoined(false);
    dropAllPeers();
    for (const track of localRef.current?.getTracks() ?? []) track.stop();
    localRef.current = null;
    setLocalStream(null);
    setMuted(false);
    setCameraOff(false);
  }, [dropAllPeers]);

  useEffect(() => chat.onCallPacket(async (packet) => {
    if (packet.type === 'error') {
      setError(packet.message);
      if (['CALL_FULL', 'CALL_ALREADY_JOINED'].includes(packet.code)) leave();
      return;
    }
    if (!joinedRef.current || packet.type !== 'rtc_signal') return;
    const peerId = packet.fromPeerId;
    if (packet.signal.type === 'media') {
      setRemoteMedia((current) => new Map(current).set(peerId, packet.signal));
      return;
    }
    try {
      const peer = ensurePeer(peerId);
      if (packet.signal.type === 'offer') {
        await peer.setRemoteDescription(packet.signal);
        await peer.setLocalDescription(await peer.createAnswer());
        transport.current.sendPacket({ type: 'rtc_signal', targetPeerId: peerId,
          signal: peer.localDescription.toJSON() });
      } else if (packet.signal.type === 'answer') {
        await peer.setRemoteDescription(packet.signal);
      } else if (packet.signal.type === 'candidate') {
        if (peer.remoteDescription) await peer.addIceCandidate(packet.signal.candidate);
        else candidates.current.set(peerId, [...(candidates.current.get(peerId) ?? []), packet.signal.candidate]);
      }
      if (peer.remoteDescription && candidates.current.has(peerId)) {
        for (const candidate of candidates.current.get(peerId)) await peer.addIceCandidate(candidate);
        candidates.current.delete(peerId);
      }
    } catch { setError('A call connection update failed. Try rejoining.'); }
  }), [chat.onCallPacket, ensurePeer, leave]);

  useEffect(() => {
    if (!joined || chat.status !== 'connected' || !chat.peerId) {
      if (joined && chat.status !== 'connected') { joinedPeer.current = null; dropAllPeers(); }
      return;
    }
    if (joinedPeer.current !== chat.peerId) {
      joinedPeer.current = chat.peerId;
      chat.sendPacket({ type: 'call_join' });
    }
  }, [joined, chat.status, chat.peerId, chat.sendPacket, dropAllPeers]);

  useEffect(() => {
    if (!joined || chat.status !== 'connected' || !chat.peerId) return;
    const others = chat.callParticipants.filter((participant) => participant.peerId !== chat.peerId);
    const active = new Set(others.map((participant) => participant.peerId));
    for (const peerId of peers.current.keys()) if (!active.has(peerId)) dropPeer(peerId);
    for (const participant of others) {
      ensurePeer(participant.peerId);
      if (chat.peerId.localeCompare(participant.peerId) < 0) offerTo(participant.peerId);
    }
  }, [joined, chat.status, chat.peerId, chat.callParticipants, dropPeer, ensurePeer, offerTo]);

  async function join() {
    if (joiningRef.current || joinedRef.current || chat.status !== 'connected') return;
    const request = ++joinRequest.current;
    joiningRef.current = true;
    setJoining(true);
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } },
      });
      if (request !== joinRequest.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      localRef.current = stream;
      joinedRef.current = true;
      setLocalStream(stream);
      setJoined(true);
      setMuted(false);
      setCameraOff(false);
      return true;
    } catch (err) {
      if (request !== joinRequest.current) return;
      setError(err.name === 'NotAllowedError' ?
        'Camera and microphone permission is required to join.' :
        'Camera or microphone is unavailable on this device.');
    } finally {
      if (request === joinRequest.current) { joiningRef.current = false; setJoining(false); }
    }
    return false;
  }

  useEffect(() => () => leave(), [leave]);

  function toggleMute() {
    const next = !muted;
    for (const track of localRef.current?.getAudioTracks() ?? []) track.enabled = !next;
    setMuted(next);
    for (const peerId of peers.current.keys()) transport.current.sendPacket({
      type: 'rtc_signal', targetPeerId: peerId, signal: mediaState(),
    });
  }
  function toggleCamera() {
    const next = !cameraOff;
    for (const track of localRef.current?.getVideoTracks() ?? []) track.enabled = !next;
    setCameraOff(next);
    for (const peerId of peers.current.keys()) transport.current.sendPacket({
      type: 'rtc_signal', targetPeerId: peerId, signal: mediaState(),
    });
  }

  const relayAvailable = chat.iceServers.some((server) =>
    (Array.isArray(server.urls) ? server.urls : [server.urls]).some((url) => /^turns?:/i.test(url)));
  return { joined, joining, localStream, remoteStreams, remoteMedia, connections, relayAvailable,
    participants: chat.callParticipants, error,
    muted, cameraOff, join, leave, toggleMute, toggleCamera };
}
