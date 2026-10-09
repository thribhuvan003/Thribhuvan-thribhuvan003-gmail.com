import React, { useEffect, useRef } from 'react';

function StreamVideo({ stream, muted, testId }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return <video ref={ref} data-testid={testId} autoPlay playsInline muted={muted} />;
}

export default function VideoCall({ call, peerId, user }) {
  const others = call.participants.filter((participant) => participant.peerId !== peerId);
  return <section className="video-call-stage" data-testid="video-call" aria-label="Team video call">
    <div className="video-call-head"><div><strong>Team video call</strong>
      <span>{call.participants.length} of 6 people</span></div>
      <p>Invite-only · camera and microphone travel directly between teammates</p></div>
    <div className="video-grid">
      <article className="video-tile local"><StreamVideo stream={call.localStream} muted testId="local-video" />
        {call.cameraOff && <div className="video-placeholder">Camera off</div>}
        <span>{user.name} · You</span></article>
      {others.map((participant) => <article className="video-tile" key={participant.peerId}
        data-testid="call-participant">
        {call.remoteStreams.get(participant.peerId) ?
          <StreamVideo stream={call.remoteStreams.get(participant.peerId)} testId="remote-video" /> :
          <div className="video-placeholder">Connecting…</div>}
        <span>{participant.name}</span></article>)}
      {!others.length && <div className="video-waiting">Waiting for an invited teammate to join…</div>}
    </div>
    <div className="video-controls">
      <button type="button" data-testid="call-mute" aria-pressed={call.muted} onClick={call.toggleMute}>
        {call.muted ? 'Unmute' : 'Mute'}</button>
      <button type="button" data-testid="call-camera" aria-pressed={call.cameraOff} onClick={call.toggleCamera}>
        {call.cameraOff ? 'Turn camera on' : 'Turn camera off'}</button>
      <button type="button" className="leave-call" data-testid="call-leave" onClick={call.leave}>Leave call</button>
    </div>
  </section>;
}
