import React, { useEffect, useRef, useState } from 'react';

export default function TeamInvite({ open, roles, onCreate, onClose }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(roles.includes('viewer') ? 'viewer' : roles[0] || '');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [copyMessage, setCopyMessage] = useState('');
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const link = result ? `${window.location.origin}/invite/${encodeURIComponent(result.inviteToken)}` : '';

  async function submit(event) {
    event.preventDefault();
    if (sending) return;
    setSending(true); setCopyMessage('');
    try {
      const created = await onCreate({ email: email.trim(), role });
      if (created && mounted.current) { setResult(created); onClose(); }
    } finally { if (mounted.current) setSending(false); }
  }

  return <>
    {open && <form className="team-invite-form" onSubmit={submit}>
      <div><strong>Invite a teammate</strong>
        <p>Choose their email and role. Only this invitation can add them to your company.</p></div>
      <label>Teammate email<input data-testid="invite-recipient" type="email" autoComplete="off" required
        value={email} onChange={(event) => setEmail(event.target.value)} placeholder="teammate@example.com" /></label>
      <label>Starting role<select data-testid="invite-starting-role" value={role}
        onChange={(event) => setRole(event.target.value)}>
        {roles.map((key) => <option key={key} value={key}>{key.replaceAll('_', ' ')}</option>)}
      </select></label>
      <small>Viewer is the usual starting role for someone who needs chat and video calls.
        Device access is managed separately in Access rules.</small>
      <div className="actions"><button className="primary" data-testid="create-invite-link" disabled={sending}>
        {sending ? 'Creating…' : 'Create invite link'}</button>
        <button type="button" disabled={sending} onClick={onClose}>Cancel</button></div>
    </form>}
    {result && <div className="team-invite-result" data-testid="invite-link-result" role="status">
      <strong>Invitation ready for {result.email}</strong>
      <p>Share this link privately with that teammate. They open it, enter their name and password,
        then sign in. This app does not send an email automatically.</p>
      <div className="invite-link-row"><a href={link} target="_blank" rel="noopener noreferrer"
        data-testid="invite-share-link">{link}</a>
        <button type="button" data-testid="copy-invite-link" onClick={async () => {
          try { await navigator.clipboard.writeText(link); setCopyMessage('Link copied.'); }
          catch { setCopyMessage('Select the link text above and copy it.'); }
        }}>Copy link</button></div>
      <small>Expires {new Date(result.expiresAt).toLocaleString()}. It can only be accepted once.</small>
      {copyMessage && <p>{copyMessage}</p>}
      <button type="button" className="quiet" onClick={() => setResult(null)}>Dismiss invitation details</button>
    </div>}
  </>;
}
