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
  const [screenStream, setScreenStream] = useState(null);
  const [sharePending, setSharePending] = useState(false);
  const joinedRef = useRef(false);
  const joinRequest = useRef(0);
  const joiningRef = useRef(false);
  const joinedPeer = useRef(null);
  const localRef = useRef(null);
  const screenRef = useRef(null);
  const shareRequest = useRef(0);
  const sharingRef = useRef(false);
  const videoSenders = useRef(new Map());
  const peers = useRef(new Map());
  const remoteRefs = useRef(new Map());
  const candidates = useRef(new Map());
  const offered = useRef(new Set());
  const transport = useRef(chat);
  transport.current = chat;

  const dropPeer = useCallback((peerId) => {
    peers.current.get(peerId)?.close();
    peers.current.delete(peerId);
    videoSenders.current.delete(peerId);
    remoteRefs.current.delete(peerId);
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
    return { type: 'media', muted: !localRef.current?.getAudioTracks().some((track) => track.enabled && track.readyState === 'live'),
      cameraOff: !screenRef.current && !localRef.current?.getVideoTracks().some((track) => track.enabled && track.readyState === 'live'),
      sharing: !!screenRef.current };
  }

  function broadcastMedia() {
    for (const peerId of peers.current.keys()) transport.current.sendPacket({
      type: 'rtc_signal', targetPeerId: peerId, signal: mediaState(),
    });
  }

  const ensurePeer = useCallback((peerId) => {
    if (peers.current.has(peerId)) return peers.current.get(peerId);
    const peer = new RTCPeerConnection({ iceServers: transport.current.iceServers });
    for (const track of localRef.current?.getAudioTracks() ?? []) peer.addTrack(track, localRef.current);
    const videoTrack = screenRef.current?.getVideoTracks()[0] ?? localRef.current?.getVideoTracks()[0];
    // Reserve both directions so audio-only members can receive video and later present.
    videoSenders.current.set(peerId, videoTrack ? peer.addTrack(videoTrack, localRef.current) :
      peer.addTransceiver('video', { direction: 'sendrecv', streams: [localRef.current] }).sender);
    peer.onicecandidate = (event) => {
      if (event.candidate) transport.current.sendPacket({ type: 'rtc_signal', targetPeerId: peerId,
        signal: { type: 'candidate', candidate: event.candidate.toJSON() } });
    };
    peer.ontrack = (event) => {
      if (peers.current.get(peerId) !== peer) return;
      // Aggregate tracks even when a reserved video sender has no stream ID yet.
      const stream = remoteRefs.current.get(peerId) ?? new MediaStream();
      if (!stream.getTracks().some(track => track.id === event.track.id)) stream.addTrack(event.track);
      remoteRefs.current.set(peerId, stream);
      setRemoteStreams((current) => new Map(current).set(peerId, stream));
    };
    peer.onconnectionstatechange = () => {
      if (peers.current.get(peerId) !== peer) return;
      setConnections((current) => new Map(current).set(peerId, peer.connectionState));
      if (peer.connectionState === 'failed') setError('The call could not reconnect. Leave and join again.');
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
      if (joinedRef.current) setError('The call could not connect. Try leaving and joining again.');
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
    shareRequest.current++;
    sharingRef.current = false;
    setSharePending(false);
    for (const track of screenRef.current?.getTracks() ?? []) track.stop();
    screenRef.current = null;
    setScreenStream(null);
    for (const track of localRef.current?.getTracks() ?? []) track.stop();
    localRef.current = null;
    setLocalStream(null);
    setMuted(false);
    setCameraOff(false);
    setError(null);
  }, [dropAllPeers]);

  useEffect(() => chat.onCallPacket(async (packet) => {
    if (packet.type === 'error') {
      setError(packet.message);
      if (['CALL_FULL', 'CALL_ALREADY_JOINED'].includes(packet.code)) { leave(); setError(packet.message); }
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
        // A null-track reservation may not be associated with an incoming offer.
        // Use the video transceiver that actually received a negotiated MID.
        const video = peer.getTransceivers().find(item => item.receiver.track.kind === 'video' && item.mid !== null);
        if (video) {
          const reserved = peer.getTransceivers().find(item => item.sender === videoSenders.current.get(peerId));
          if (reserved !== video && reserved?.mid === null) reserved.stop();
          video.direction = 'sendrecv';
          video.sender.setStreams(localRef.current);
          await video.sender.replaceTrack(screenRef.current?.getVideoTracks()[0] ??
            localRef.current?.getVideoTracks().find(track => track.readyState === 'live') ?? null);
          videoSenders.current.set(peerId, video.sender);
        }
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
    } catch { if (joinedRef.current) setError('A call connection update failed. Try rejoining.'); }
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

  const cancelJoin = useCallback(() => {
    if (!joiningRef.current) return;
    joinRequest.current++;
    joiningRef.current = false;
    setJoining(false);
    setError(null);
  }, []);

  async function join({ video = true, startMuted = false } = {}) {
    if (joiningRef.current || joinedRef.current || chat.status !== 'connected') return;
    const request = ++joinRequest.current;
    joiningRef.current = true;
    setJoining(true);
    setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Your browser cannot access media here. Open the secure HTTPS link in a supported browser.');
        return false;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: video ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } } : false,
      });
      if (request !== joinRequest.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      if (transport.current.status !== 'connected') {
        for (const track of stream.getTracks()) track.stop();
        setError('The connection changed while starting the call. Wait for chat to reconnect, then try again.');
        return false;
      }
      for (const track of stream.getTracks()) track.addEventListener('ended', () => {
        if (localRef.current !== stream) return;
        if (track.kind === 'video') setCameraOff(true);
        if (track.kind === 'audio') setMuted(true);
        setError('A camera or microphone disconnected. Leave and rejoin after reconnecting your device.');
        for (const peerId of peers.current.keys()) transport.current.sendPacket({
          type: 'rtc_signal', targetPeerId: peerId, signal: mediaState(),
        });
      });
      // Apply the user's choice before a peer can attach or transmit this track.
      for (const track of stream.getAudioTracks()) track.enabled = !startMuted;
      localRef.current = stream;
      joinedRef.current = true;
      setLocalStream(stream);
      setJoined(true);
      setMuted(startMuted);
      setCameraOff(!video);
      return true;
    } catch (err) {
      if (request !== joinRequest.current) return;
      setError(err.name === 'NotAllowedError' ?
        `${video ? 'Camera and microphone' : 'Microphone'} permission is required to join. Allow access in your browser settings, then try again.` :
        err.name === 'NotReadableError' ? 'A device is busy. Close other apps using it, then try again.' :
        video ? 'Camera or microphone is unavailable. Try Audio only if you do not have a working camera.' :
        'Microphone is unavailable. Connect one, then try again.');
    } finally {
      if (request === joinRequest.current) { joiningRef.current = false; setJoining(false); }
    }
    return false;
  }

  useEffect(() => () => leave(), [leave]);

  async function stopSharing() {
    const stream = screenRef.current;
    if (!stream) return;
    const request = ++shareRequest.current;
    screenRef.current = null;
    setScreenStream(null);
    // Stop capture immediately, before waiting on any sender operation.
    for (const track of stream.getTracks()) track.stop();
    setSharePending(true);
    const camera = localRef.current?.getVideoTracks().find(track => track.readyState === 'live') ?? null;
    const senders = [...videoSenders.current.entries()];
    const results = await Promise.allSettled(senders.map(([, sender]) => sender.replaceTrack(camera)));
    if (request !== shareRequest.current || !joinedRef.current) return;
    sharingRef.current = false;
    setSharePending(false);
    broadcastMedia();
    if (results.some((result, index) => result.status === 'rejected' &&
      videoSenders.current.get(senders[index][0]) === senders[index][1])) {
      setError('Screen sharing stopped, but your camera could not be restored. Leave and join again.');
    }
  }

  async function startSharing() {
    if (!joinedRef.current || sharingRef.current || transport.current.status !== 'connected') return;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError('Screen sharing is unavailable in this browser. Try a supported desktop browser.');
      return;
    }
    const request = ++shareRequest.current;
    const sessionRequest = joinRequest.current;
    sharingRef.current = true;
    setSharePending(true);
    setError(null);
    let stream;
    try {
      // Called directly from the user's click; every share uses the browser's chooser.
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 15, max: 30 } },
        audio: false, selfBrowserSurface: 'exclude', surfaceSwitching: 'include',
      });
      if (request !== shareRequest.current || !joinedRef.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      const track = stream.getVideoTracks()[0];
      if (!track || track.readyState !== 'live') throw new Error('No live display track');
      track.contentHint = 'detail';
      screenRef.current = stream;
      track.addEventListener('ended', () => { if (screenRef.current === stream) void stopSharing(); }, { once: true });
      const senders = [...videoSenders.current.entries()];
      const results = await Promise.allSettled(senders.map(([, sender]) => sender.replaceTrack(track)));
      if (request !== shareRequest.current || !joinedRef.current) return;
      if (results.some((result, index) => result.status === 'rejected' &&
        videoSenders.current.get(senders[index][0]) === senders[index][1])) throw new Error('Display sender replacement failed');
      setScreenStream(stream);
      broadcastMedia();
    } catch (err) {
      if (request !== shareRequest.current || !joinedRef.current) return;
      if (screenRef.current === stream && stream) await stopSharing();
      else for (const track of stream?.getTracks() ?? []) track.stop();
      if (joinedRef.current && sessionRequest === joinRequest.current && err.name !== 'NotAllowedError') {
        setError('Screen sharing could not start. Try another window or tab.');
      }
    } finally {
      if (request === shareRequest.current) {
        sharingRef.current = !!screenRef.current;
        setSharePending(false);
      }
    }
  }

  function toggleMute() {
    if (!localRef.current?.getAudioTracks().some((track) => track.readyState === 'live')) return;
    const next = !muted;
    for (const track of localRef.current?.getAudioTracks() ?? []) track.enabled = !next;
    setMuted(next);
    for (const peerId of peers.current.keys()) transport.current.sendPacket({
      type: 'rtc_signal', targetPeerId: peerId, signal: mediaState(),
    });
  }
  function toggleCamera() {
    if (!localRef.current?.getVideoTracks().some((track) => track.readyState === 'live')) return;
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
    screenStream, sharePending, startSharing, stopSharing,
    shareSupported: !!navigator.mediaDevices?.getDisplayMedia,
    participants: chat.callParticipants, transportStatus: chat.status, error,
    muted, cameraOff, audioOnly: joined && !localStream?.getVideoTracks().length,
    join, cancelJoin, leave, toggleMute, toggleCamera };
}
