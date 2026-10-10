import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useChat } from './useChat.js';
import { useVideoCall } from './useVideoCall.js';
import VideoCall from './VideoCall.jsx';
import { participantColor } from './participantColor.js';
import FloatingWindow from './FloatingWindow.jsx';
import Icon from './Icons.jsx';

const initials = (name) => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
const dayLabel = (value) => {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return 'Today';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
};
const timeLabel = (value) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function SendIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="m21 3-7 18-4-7-7-4 18-7Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    <path d="m10 14 11-11" stroke="currentColor" strokeWidth="1.7" />
  </svg>;
}

export default function Chat({ session, authed, onAuthExpired, onMembers, compact, hidden,
  onClose, onExpand, onFloat, onUnreadChange }) {
  const [minimized, setMinimized] = useState(false);
  const [pageVisible, setPageVisible] = useState(document.visibilityState !== 'hidden');
  const [unread, setUnread] = useState(0);
  const readable = !hidden && (!compact || !minimized) && pageVisible;
  const readableRef = useRef(readable);
  readableRef.current = readable;
  const chat = useChat({ session, authed, onAuthExpired,
    onIncoming: () => { if (!readableRef.current) setUnread((count) => count + 1); } });
  const call = useVideoCall({ chat });
  const [text, setText] = useState('');
  const historyRef = useRef(null);
  const nearBottom = useRef(true);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const olderPosition = useRef(null);
  const org = session.orgs.find((item) => item.id === session.orgId);
  const connected = chat.status === 'connected';

  useEffect(() => {
    const update = () => setPageVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useEffect(() => { if (readable) setUnread(0); }, [readable]);
  useEffect(() => { onUnreadChange?.(unread); }, [unread, onUnreadChange]);

  useEffect(() => {
    const area = historyRef.current;
    if (!area) return;
    if (olderPosition.current) {
      area.scrollTop = olderPosition.current.top + area.scrollHeight - olderPosition.current.height;
      olderPosition.current = null;
    } else if (nearBottom.current) area.scrollTop = area.scrollHeight;
  }, [chat.messages, chat.pending, readable]);

  function send(event) {
    event.preventDefault();
    if (chat.send(text)) { nearBottom.current = true; setText(''); }
  }

  async function older() {
    const area = historyRef.current;
    olderPosition.current = { top: area.scrollTop, height: area.scrollHeight };
    if (!await chat.loadOlder()) olderPosition.current = null;
  }

  return <>
    <FloatingWindow enabled={compact && !hidden} title={<>
      Team chat {unread > 0 && <span className="chat-unread-badge">{unread > 99 ? '99+' : unread}</span>}
    </>} label="team chat"
      corner="top-left"
      testId="chat-window" className={`floating-chat ${hidden ? 'chat-window-hidden' : ''}`}
      onClose={onClose} onExpand={onExpand} onMinimizeChange={setMinimized}>
    <section className={`team-chat ${compact ? 'compact' : ''}`} data-testid="chat-panel">
    <div className="chat-main">
      <header className="chat-head">
        <span className="channel-mark" aria-hidden="true">#</span>
        <div className="channel-title"><h2>Team chat <span className="private-tag">Team channel</span></h2>
          <p>Playtests, creative reviews, and remote workstation handoffs.</p></div>
        <span className={`chat-connection ${chat.status}`} data-testid="chat-status" role="status">
          <span className="connection-dot" />
          {connected ? `${chat.users.length} online` : chat.status === 'syncing' ?
            'Catching up…' : chat.status === 'offline' ? 'Offline' : 'Connecting…'}
        </span>
        <button type="button" className={`call-toggle ${call.joined ? 'live' : ''}`}
          data-testid="call-toggle" disabled={call.joining || (!call.joined && !connected)}
          onClick={call.joined ? call.leave : async () => { if (await call.join()) onFloat?.(); }}>
          <Icon name="video" size={16} />
          {call.joined ? 'Leave video' : call.joining ? 'Starting…' : call.participants.length ?
            `Join video · ${call.participants.length}` : 'Start video'}</button>
        {!compact && <button type="button" className="chat-float-button" aria-label="Float team chat"
          title="Move chat into a floating window" onClick={onFloat}><Icon name="float" /></button>}
      </header>

      {call.error && !call.joined && <p className="call-error" role="alert">{call.error}</p>}

      <div className="chat-history" data-testid="chat-history" ref={historyRef}
        role="log" aria-label="Team messages" aria-live="polite" aria-relevant="additions"
        onScroll={() => {
          const area = historyRef.current;
          nearBottom.current = area.scrollHeight - area.scrollTop - area.clientHeight < 80;
          setAwayFromBottom(!nearBottom.current);
        }}>
        {chat.cursor && <button type="button" className="load-older" disabled={chat.loadingOlder}
          onClick={older}>{chat.loadingOlder ? 'Loading…' : 'Load earlier messages'}</button>}
        {!chat.messages.length && !chat.pending.length && <div className="chat-welcome">
          <span className="welcome-symbol" aria-hidden="true">#</span>
          <p className="eyebrow">Your team, in one place</p>
          <h3>A little conversation.<br />A lot less switching.</h3>
          <p>Plan a playtest, review a 3D build,<br />or agree on who uses a workstation next.</p>
          <div className="welcome-prompts">
            {['Is the design workstation free?', 'Quick update for the team…'].map((prompt) =>
              <button type="button" key={prompt} onClick={() => setText(prompt)}>{prompt} ↗</button>)}
          </div>
        </div>}
        {chat.messages.map((message, index) => {
          const mine = message.sender.id === session.user.id;
          const previous = chat.messages[index - 1];
          const newDay = !previous || dayLabel(previous.createdAt) !== dayLabel(message.createdAt);
          const grouped = !newDay && previous.sender.id === message.sender.id &&
            new Date(message.createdAt) - new Date(previous.createdAt) < 300_000;
          return <React.Fragment key={message.id}>
            {newDay && <div className="chat-day"><span>{dayLabel(message.createdAt)}</span></div>}
            <article className={`chat-message ${mine ? 'mine' : ''} ${grouped ? 'grouped' : ''}`}
              style={participantColor(message.sender.id)}
              data-testid="chat-message" data-message-id={message.id} data-seq={message.seq}>
              <span className="chat-avatar" aria-hidden="true">{grouped ? '' : initials(message.sender.name)}</span>
              <div className="chat-message-content">
                {!grouped && <div className="chat-meta"><strong>{message.sender.name}</strong>
                  {mine && <span className="you-tag">you</span>}
                  <time dateTime={message.createdAt}>{timeLabel(message.createdAt)}</time></div>}
                <p>{message.body}</p>
              </div>
            </article>
          </React.Fragment>;
        })}
        {chat.pending.map((item) => <article className="chat-message pending" key={item.clientId}
          style={participantColor(session.user.id)}
          data-testid="chat-pending">
          <span className="chat-avatar" aria-hidden="true">{initials(session.user.name)}</span>
          <div className="chat-message-content">
            <div className="chat-meta"><strong>{session.user.name}</strong><span>
              {item.state === 'failed' ? 'Could not confirm delivery' : 'Sending…'}</span></div>
            <p>{item.body}</p>
            {item.state === 'failed' && <button type="button" className="chat-retry"
              disabled={!connected} onClick={() => chat.retry(item.clientId)}>Retry</button>}
          </div>
        </article>)}
      </div>

      {awayFromBottom && <button type="button" className="chat-jump" data-testid="chat-jump"
        onClick={() => {
          nearBottom.current = true;
          historyRef.current.scrollTop = historyRef.current.scrollHeight;
          setAwayFromBottom(false);
        }}>↓ Latest messages</button>}

      {chat.error && <p className="chat-error" role="alert">{chat.error}</p>}
      <form className="chat-composer" onSubmit={send}>
        <label htmlFor="chat-message" className="sr-only">Message your team</label>
        <textarea id="chat-message" data-testid="chat-input" rows="2" maxLength={2000} enterKeyHint="send"
          value={text} placeholder="Message your team…"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) send(event);
          }} />
        <div className="chat-compose-foot"><span>Enter to send <b>·</b> Shift + Enter for a new line</span>
          <div><span className="chat-count">{text.length ? `${text.length}/2000` : ''}</span>
            <button className="chat-send" data-testid="chat-send" disabled={!text.trim() || !connected}>
              Send <SendIcon />
            </button></div>
        </div>
      </form>
      <div className="chat-footnote">Only invited, active members of {org?.name} can join this conversation.</div>
    </div>

    <aside className="chat-team" aria-label="Team information">
      <div className="team-org"><span className="team-org-mark">{initials(org?.name || 'Team')}</span>
        <h3>{org?.name}</h3><p>Your team workspace</p></div>
      <div className="team-online-head"><h3>Here right now</h3><span>{chat.users.length}</span></div>
      <div className="online-members">{chat.users.map((user) =>
        <div className="online-member" key={user.id} style={participantColor(user.id)}>
          <span className="chat-avatar">{initials(user.name)}</span>
          <span>{user.name}{user.id === session.user.id && <small>That's you</small>}</span>
          <i className="connection-dot" aria-label="Online" /></div>)}
        {!chat.users.length && <p className="muted">{connected ? 'No one else is here yet.' : 'Reconnecting to your team…'}</p>}
      </div>
      <div className="chat-purpose"><span aria-hidden="true">↗</span><h3>Built for play and creation.</h3>
        <p>Coordinate remote game sessions, playtests, 3D reviews, and shared workstation handoffs.</p>
      </div>
      {onMembers && <button type="button" className="chat-members-link" onClick={onMembers}>Manage team members ↗</button>}
    </aside>
    </section>
    </FloatingWindow>
    {call.joined && createPortal(<VideoCall call={call} peerId={chat.peerId} user={session.user}
      orgName={org?.name} />, document.body)}
  </>;
}
