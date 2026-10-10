import React, { useEffect, useRef, useState } from 'react';
import FloatingWindow from './FloatingWindow.jsx';
import Icon from './Icons.jsx';
import { participantColor } from './participantColor.js';

const initials = (name) => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();

function StreamVideo({ stream, muted, testId }) {
  const ref = useRef(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const video = ref.current;
    let live = true;
    video.srcObject = stream;
    setBlocked(false);
    video.play().catch((error) => { if (live && error.name === 'NotAllowedError') setBlocked(true); });
    return () => { live = false; video.srcObject = null; };
  }, [stream]);
  return <><video ref={ref} data-testid={testId} autoPlay playsInline muted={muted} />
    {blocked && <button type="button" className="video-play" onClick={() => {
      ref.current.play().then(() => setBlocked(false)).catch(() => {});
    }}>Play video and audio</button>}</>;
}

function Tile({ stream, name, userId, local, cameraOff, muted, sharing, connection = 'connecting' }) {
  return <article className={`video-tile ${local ? 'local' : ''} ${sharing ? 'is-presenting' : ''}`}
    style={participantColor(userId)} data-testid={local ? 'call-local' : 'call-participant'}>
    {stream && <StreamVideo stream={stream} muted={local} testId={local ? 'local-video' : 'remote-video'} />}
    {(!stream || cameraOff || (!local && connection !== 'connected')) && <div className="video-placeholder">
      <span className="video-avatar">{initials(name)}</span>
      <small>{cameraOff ? 'Camera off' : connection === 'failed' ? 'Could not connect' : connection === 'disconnected' ? 'Reconnecting…' : 'Connecting…'}</small>
    </div>}
    {sharing && <span className="video-presenting"><Icon name="screen" size={13} /> Sharing screen</span>}
    <div className="video-person"><span className={`video-person-dot ${!local && connection !== 'connected' ? 'pending' : ''}`} /><span>{name}{local ? ' · You' : ''}</span>
      {muted && <span className="video-muted" aria-label={`${name} is muted`}><Icon name="micOff" size={13} /></span>}</div>
  </article>;
}

export default function VideoCall({ call, peerId, user, orgName }) {
  const others = call.participants.filter((participant) => participant.peerId !== peerId);
  const reconnecting = call.transportStatus !== 'connected' || others.some((participant) =>
    ['disconnected', 'failed'].includes(call.connections.get(participant.peerId)));
  const connected = others.some((participant) => call.connections.get(participant.peerId) === 'connected');
  const presenting = !!call.screenStream || others.some(participant => call.remoteMedia.get(participant.peerId)?.sharing);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  const duration = `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  return <FloatingWindow title="Team call" label="video call" testId="video-window"
    className="floating-video" corner="top-right" collapseContent={false} onClose={call.leave}>
    <section className="video-call-stage" data-testid="video-call" aria-label="Team video call">
      <div className="video-call-head"><div><span className={`call-live-badge ${reconnecting ? 'reconnecting' : ''}`} role="status"><i />{reconnecting ? 'Reconnecting' : connected ? 'Live call' : others.length ? 'Connecting' : 'Ready to connect'}</span>
        <span className="call-duration">{duration}</span></div>
        <span><Icon name="people" size={14} /> {Math.max(1, call.participants.length)} / 6 people</span></div>
      <div className={`video-grid ${presenting ? 'has-presentation' : ''}`}>
        <Tile stream={call.screenStream ?? call.localStream} name={user.name} userId={user.id} local
          sharing={!!call.screenStream} cameraOff={!call.screenStream && call.cameraOff} muted={call.muted} />
        {others.map((participant) => <Tile key={participant.peerId}
          stream={call.remoteStreams.get(participant.peerId)} name={participant.name} userId={participant.userId}
          cameraOff={call.remoteMedia.get(participant.peerId)?.cameraOff}
          sharing={call.remoteMedia.get(participant.peerId)?.sharing}
          connection={call.connections.get(participant.peerId)}
          muted={call.remoteMedia.get(participant.peerId)?.muted} />)}
        {!others.length && <div className="video-waiting"><span className="waiting-orbit"><Icon name="people" size={25} /></span>
          <strong>Better with your team</strong><p>Invite a friend to {orgName || 'your workspace'},<br />then ask them to join this call.</p></div>}
      </div>
      {call.error && <p className="call-error" role="alert">{call.error}</p>}
      <div className="video-controls">
        <button type="button" data-testid="call-mute" className={call.muted ? 'control-off' : ''}
          aria-label={call.muted ? 'Unmute microphone' : 'Mute microphone'}
          aria-pressed={call.muted} onClick={call.toggleMute} title={call.muted ? 'Turn microphone on' : 'Turn microphone off'}>
          <Icon name={call.muted ? 'micOff' : 'mic'} /><span>{call.muted ? 'Unmute' : 'Mute'}</span></button>
        <button type="button" data-testid="call-camera" className={call.cameraOff ? 'control-off' : ''}
          disabled={call.audioOnly || !!call.screenStream || call.sharePending}
          title={call.audioOnly ? 'Rejoin with video to enable your camera' : call.screenStream ? 'Camera returns when sharing stops' : undefined}
          aria-label={call.audioOnly ? 'Camera off for audio-only call' : call.screenStream ? 'Camera paused while sharing' : call.cameraOff ? 'Turn camera on' : 'Turn camera off'}
          aria-pressed={call.cameraOff} onClick={call.toggleCamera}>
          <Icon name={call.cameraOff || call.screenStream ? 'cameraOff' : 'video'} /><span>{call.audioOnly ? 'Audio only' : call.screenStream ? 'Camera paused' : call.cameraOff ? 'Turn camera on' : 'Turn camera off'}</span></button>
        <button type="button" data-testid="call-share" className={call.screenStream ? 'control-sharing' : ''}
          aria-pressed={!!call.screenStream} disabled={call.sharePending || !call.shareSupported || call.transportStatus !== 'connected' && !call.screenStream}
          title={!call.shareSupported ? 'Screen sharing needs a supported desktop browser' : undefined}
          onClick={call.screenStream ? call.stopSharing : call.startSharing}>
          <Icon name="screen" /><span>{!call.shareSupported ? 'Share unavailable' : call.sharePending ? 'Please wait…' : call.screenStream ? 'Stop sharing' : 'Share screen'}</span></button>
        <button type="button" className="leave-call" data-testid="call-leave" onClick={call.leave}>
          <Icon name="phone" /><span>Leave call</span></button>
      </div>
      <p className="call-footnote">{!call.shareSupported ? 'Screen sharing is unavailable here. You can still talk and view shared screens.' : call.screenStream ? 'You are sharing your selected screen. Microphone audio continues.' : call.audioOnly ? 'Audio only · Rejoin with video to enable your camera.' :
        'Your call stays connected while you move or minimize this window.'}</p>
    </section>
  </FloatingWindow>;
}
