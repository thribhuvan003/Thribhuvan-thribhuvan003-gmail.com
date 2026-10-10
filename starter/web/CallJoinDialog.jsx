import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icons.jsx';

export default function CallJoinDialog({ call, connected, orgName, onJoined, onCancel, returnFocusRef }) {
  const ref = useRef(null);
  const [video, setVideo] = useState(true);
  const [startMuted, setStartMuted] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => { call.cancelJoin(); dialog.close(); returnFocusRef.current?.focus({ preventScroll: true }); };
  }, [call.cancelJoin, returnFocusRef]);

  async function submit(event) {
    event.preventDefault();
    if (await call.join({ video, startMuted })) onJoined();
  }

  return createPortal(<dialog ref={ref} className="call-join-dialog" data-testid="call-join-dialog"
    aria-labelledby="call-join-title" aria-describedby="call-join-note"
    onCancel={(event) => { event.preventDefault(); onCancel(); }}>
    <form onSubmit={submit}>
      <div className="call-join-heading"><span className="call-join-mark"><Icon name="video" size={22} /></span>
        <div><p className="eyebrow">{orgName || 'Your team'}</p><h2 id="call-join-title">Join on your terms</h2></div></div>
      <fieldset disabled={call.joining} className="call-join-modes">
        <legend>Choose how to join</legend>
        <label className={video ? 'selected' : ''}><input type="radio" name="call-mode" value="video"
          checked={video} onChange={() => setVideo(true)} autoFocus />
          <Icon name="video" /><span>Video and audio<small>Use your camera and microphone</small></span></label>
        <label className={!video ? 'selected' : ''}><input type="radio" name="call-mode" value="audio"
          checked={!video} onChange={() => setVideo(false)} data-testid="call-mode-audio" />
          <Icon name="mic" /><span>Audio only<small>Keep your camera off for this call</small></span></label>
      </fieldset>
      <label className="call-join-muted"><input type="checkbox" checked={startMuted}
        disabled={call.joining} onChange={(event) => setStartMuted(event.target.checked)}
        data-testid="call-start-muted" />Join with microphone muted</label>
      <p id="call-join-note" className="call-join-note">Your devices are requested when you choose Join call.
        You can unmute at any time. Audio only never requests camera access.</p>
      {!connected && <p className="call-join-note" role="status">Waiting for your team connection…</p>}
      {call.joining && <p className="call-join-note" role="status">Allow access in your browser to continue. You can cancel while waiting.</p>}
      {call.error && <p className="call-error" role="alert">{call.error}</p>}
      <div className="call-join-actions"><button type="button" onClick={onCancel} data-testid="call-join-cancel">Cancel</button>
        <button type="submit" className="call-join-submit" disabled={call.joining || !connected}
          data-testid="call-join-submit">{call.joining ? 'Waiting for devices…' : 'Join call'}</button></div>
    </form>
  </dialog>, document.body);
}
