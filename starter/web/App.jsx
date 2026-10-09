import React, { useEffect, useRef, useState } from 'react';
import Chat from './Chat.jsx';
import Grants from './Grants.jsx';

async function api(path, { method = 'GET', token, body } = {}) {
  let response;
  try {
    response = await fetch(`/v1${path}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Cannot reach the server. Check that it is running.');
  }
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error?.message || `Request failed (${response.status})`);
    error.code = data.error?.code;
    error.reason = data.error?.reason;
    throw error;
  }
  return data;
}

const has = (permissions, key) => permissions?.[key]?.effect === 'allow';
const cards = [
  ['devices', 'Devices', 'device:list'],
  ['people', 'People', 'user:read'],
  ['grants', 'Access rules', 'user:read'],
  ['sessions', 'Sessions', 'session:view'],
  ['chat', 'Chat', null],
  ['audit', 'Audit', 'audit:read'],
  ['admin', 'Admin', 'org:update'],
];

function Action({ permissions, permission, testId, children, onClick }) {
  if (!has(permissions, permission)) return null;
  return <button type="button" data-testid={testId} data-permission={permission}
    data-state="unlocked" onClick={onClick}>{children}</button>;
}

function Login({ onLogin, error, clearError }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return <main className="entry-screen"><div className="entry-card">
    <p className="eyebrow">Teamroom</p><h1>Sign in</h1>
    <p className="muted">Chat, call, and coordinate with your invited team.</p>
    <form data-testid="login-form" noValidate onSubmit={(event) => {
      event.preventDefault(); clearError(); onLogin(email, password);
    }}>
      <label>Email<input data-testid="login-email" type="email" autoComplete="username"
        value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Password<input data-testid="login-password" type="password" autoComplete="current-password"
        value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <button data-testid="login-submit" className="primary">Sign in</button>
    </form>
    {error && <p className="notice error" data-testid="login-error" data-error-code={error.code || 'NETWORK'}
      role="alert">{error.message}</p>}
  </div></main>;
}

function Invite({ token, done }) {
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  useEffect(() => {
    let live = true;
    api(`/invites/${encodeURIComponent(token)}`).then((data) => {
      if (live) setInvite(data);
    }).catch((err) => { if (live) setError(err); });
    return () => { live = false; };
  }, [token]);
  return <main className="entry-screen"><div className="entry-card">
    <p className="eyebrow">Teamroom</p><h1>Invitation</h1>
    {invite && <>
      <p>You were invited to {invite.orgName} as <strong data-testid="invite-role">{invite.role}</strong>.</p>
      <form onSubmit={async (event) => {
        event.preventDefault(); setError(null);
        try { await api(`/invites/${encodeURIComponent(token)}/accept`, {
          method: 'POST', body: { name, password },
        }); done(); } catch (err) { setError(err); }
      }}>
        <label>Email<input data-testid="invite-email" value={invite.email} readOnly /></label>
        <label>Name<input data-testid="invite-name" value={name}
          onChange={(event) => setName(event.target.value)} /></label>
        <label>Password<input data-testid="invite-password" type="password" value={password}
          onChange={(event) => setPassword(event.target.value)} /></label>
        <button data-testid="invite-submit" className="primary">Accept invitation</button>
      </form>
    </>}
    {error && <p className="notice error" data-testid="invite-error" role="alert">{error.message}</p>}
  </div></main>;
}

export default function App() {
  const [session, setSession] = useState(null);
  const [booting, setBooting] = useState(true);
  const [path, setPath] = useState(window.location.pathname);
  const [skipRefresh, setSkipRefresh] = useState(false);
  const [loginError, setLoginError] = useState(null);
  const [message, setMessage] = useState(null);
  const [view, setView] = useState('devices');
  const [menuOpen, setMenuOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const lastWorkspaceView = useRef('devices');
  const [reload, setReload] = useState(0);
  const [rows, setRows] = useState([]);
  const [members, setMembers] = useState([]);
  const [devices, setDevices] = useState([]);
  const [catalogue, setCatalogue] = useState([]);
  const refreshRequest = useRef(null);

  useEffect(() => {
    if (skipRefresh || path.startsWith('/invite/')) { setBooting(false); return; }
    const orgId = new URLSearchParams(window.location.search).get('org');
    api('/auth/refresh', { method: 'POST', body: orgId ? { orgId } : {} })
      .then(setSession).catch((err) => { if (!err.code) setLoginError(err); })
      .finally(() => setBooting(false));
  }, [path, skipRefresh]);

  function enter(data) {
    setRows([]); setMembers([]); setDevices([]);
    setCatalogue([]);
    setChatOpen(false); lastWorkspaceView.current = 'devices';
    setView('devices'); setMessage(null); setSession(data);
    window.history.replaceState(null, '', `/?org=${encodeURIComponent(data.orgId)}`);
  }
  async function login(email, password) {
    try { enter(await api('/auth/login', { method: 'POST', body: { email, password } })); }
    catch (err) { setLoginError(err); }
  }
  async function authed(path, { method = 'GET', body } = {}) {
    try {
      return await api(path, { method, body, token: session.token });
    } catch (err) {
      if (err.code !== 'TOKEN_STALE' && err.code !== 'UNAUTHENTICATED') throw err;
      const fresh = await refreshAccess();
      return api(path, { method, body, token: fresh.token });
    }
  }
  async function refreshAccess() {
    const orgId = session.orgId;
    const userId = session.user.id;
    if (refreshRequest.current?.orgId !== orgId || refreshRequest.current?.userId !== userId) {
      const request = { orgId, userId, promise: null };
      request.promise = api('/auth/refresh', { method: 'POST', body: { orgId } })
        .then((fresh) => {
          setSession((current) => current?.orgId === orgId && current?.user.id === userId ? fresh : current);
          return fresh;
        }).finally(() => {
          if (refreshRequest.current === request) refreshRequest.current = null;
        });
      refreshRequest.current = request;
    }
    return refreshRequest.current.promise;
  }
  async function switchOrg(orgId) {
    if (orgId === session.orgId) return;
    try { enter(await authed('/auth/token', {
      method: 'POST', body: { orgId },
    })); } catch (err) { setMessage(err.message); }
  }

  useEffect(() => {
    if (!session) return;
    let live = true;
    setRows([]); setMembers([]); setDevices([]);
    const read = (name) => authed(`/orgs/${encodeURIComponent(session.orgId)}/${name}`);
    async function load() {
      try {
        if (view === 'devices') {
          const data = await read('devices');
          if (live) setRows(data.devices);
        } else if (view === 'people') {
          const data = await read('members');
          if (live) setRows(data.members);
        } else if (view === 'grants') {
          const [grants, people, available] = await Promise.all([
            read('grants'), read('members'),
            has(session.permissions, 'device:list') ? read('devices') : Promise.resolve({ devices: [] }),
          ]);
          if (live) {
            setRows(grants.grants); setCatalogue(grants.catalogue);
            setMembers(people.members); setDevices(available.devices);
          }
        } else if (view === 'sessions') {
          const [sessions, available] = await Promise.all([
            read('sessions'),
            has(session.permissions, 'device:list') ? read('devices') : Promise.resolve({ devices: [] }),
          ]);
          if (live) { setRows(sessions.sessions); setDevices(available.devices); }
        } else if (view === 'audit') {
          const data = await read('audit');
          if (live) setRows(data.events);
        }
      } catch (err) { if (live) setMessage(err.message); }
    }
    load();
    return () => { live = false; };
  }, [session?.token, view, reload]);

  if (path.startsWith('/invite/')) return <Invite token={path.slice('/invite/'.length)}
    done={() => { window.history.replaceState(null, '', '/'); setSkipRefresh(true);
      setPath('/'); setSession(null); }} />;
  if (booting) return <main className="entry-screen">Opening console…</main>;
  if (!session) return <Login onLogin={login} error={loginError}
    clearError={() => setLoginError(null)} />;

  const permissions = session.permissions;
  const allowed = (key) => has(permissions, key);
  const org = session.orgs.find((item) => item.id === session.orgId);
  const orgPath = `/orgs/${encodeURIComponent(session.orgId)}`;
  async function change(path, method, body, after) {
    setMessage(null);
    try {
      const result = await authed(path, { method, body });
      if (after) await after(result);
      setReload((value) => value + 1);
      return result;
    } catch (err) {
      setMessage(err.reason ? `${err.message} (${err.reason})` : err.message);
      return null;
    }
  }
  const start = (deviceId, mode) => change(`${orgPath}/sessions`, 'POST',
    { deviceId, mode }, () => setMessage(`${mode} session started.`));

  return <div className="shell" data-testid="app-shell" data-org-id={session.orgId}
    data-org-theme={org?.theme || 'cobalt'}>
    <aside className={`sidebar ${menuOpen ? 'menu-open' : ''}`}>
      <div className="brand"><span className="brand-mark">T</span><span>Teamroom<small>Play & create</small></span></div>
      <button type="button" className="workspace-toggle" aria-expanded={menuOpen}
        aria-controls="workspace-navigation" onClick={() => setMenuOpen((open) => !open)}>
        {menuOpen ? 'Close menu' : 'Workspace ▾'}</button>
      <div className="workspace-body" id="workspace-navigation">
      <p className="section-label">Organizations</p>
      <div className="org-list">{session.orgs.map((item) => <button key={item.id}
        data-testid="org-option" data-org-id={item.id}
        className={item.id === session.orgId ? 'org-option active' : 'org-option'}
        onClick={() => switchOrg(item.id)}>{item.name}</button>)}</div>
      <button className="quiet" data-testid="create-org" onClick={async () => {
        const name = window.prompt('Organization name');
        if (!name) return;
        const created = await change('/orgs', 'POST', { name });
        if (created) {
          try { enter(await authed('/auth/token', {
            method: 'POST', body: { orgId: created.id },
          })); } catch (err) { setMessage(err.message); }
        }
      }}>+ Create organization</button>
      <p className="section-label">Workspace</p>
      <nav>{cards.map(([key, label, permission]) => {
        const gate = key === 'chat' ? 'membership:active' : key === 'admin' ? (allowed('org:update') ? 'org:update' :
          allowed('org:delete') ? 'org:delete' : null) : allowed(permission) ? permission : null;
        if (!gate) return null;
        return <button key={key} data-testid={`nav-${key}`} data-permission={gate}
          data-state="unlocked" className={view === key ? 'nav-item selected' : 'nav-item'}
          onClick={() => { setRows([]); setMembers([]); setDevices([]);
            setMenuOpen(false);
            if (key === 'chat') setChatOpen(true);
            else lastWorkspaceView.current = key;
            setView(key); setReload((value) => value + 1); setMessage(null); }}>
          {label}</button>;
      })}</nav>
      <div className="sidebar-foot"><span>{session.user.name}</span>
        <strong data-testid="active-role">{session.role}</strong>
        <button className="quiet" onClick={async () => {
          try {
            await authed('/auth/logout', { method: 'POST' });
            setSession(null);
            window.history.replaceState(null, '', '/');
          } catch (err) { setMessage(err.message); }
        }}>Sign out</button></div>
      </div>
    </aside>
    <main className="content">
      <header className="content-head"><div><p className="eyebrow">{org?.name}</p>
        <h1>{cards.find(([key]) => key === view)?.[1]}</h1></div>
        <div className="workspace-tools">
          <button type="button" className="workspace-chat-toggle" data-testid="toggle-chat"
            aria-expanded={view === 'chat' || chatOpen} onClick={() => {
              if (view === 'chat') { setChatOpen(true); setView(lastWorkspaceView.current); }
              else setChatOpen((open) => !open);
            }}>{view === 'chat' ? 'Dock chat ↘' : chatOpen ? 'Close chat' : 'Open chat'}</button>
          <span className="org-badge">{session.role}</span>
        </div></header>
      {message && <p className="notice" role="status">{message}</p>}

      {view === 'devices' && <section className="panel">
        <div className="panel-head"><h2>Devices</h2>
          <Action permissions={permissions} permission="device:provision" testId="add-device"
            onClick={() => { const name = window.prompt('Device name'); if (!name) return;
              const kind = window.prompt('Kind: macos, windows, linux, android or ios', 'linux');
              if (kind) change(`${orgPath}/devices`, 'POST', { name, kind }); }}>Add device</Action></div>
        {rows.length === 0 ? <p data-testid="devices-empty" className="empty">No devices yet.</p> :
          <div className="table-wrap"><table><thead><tr><th>Device</th><th>Kind</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>{rows.map((device) => <tr key={device.id} data-testid="device-row" data-device-id={device.id}>
              <td><strong>{device.name}</strong></td><td>{device.kind}</td>
              <td><span className={device.online ? 'status online' : 'status'}>
                {device.online ? 'Online' : 'Offline'}</span></td><td><div className="actions">
                <Action permissions={device.permissions} permission="device:view" testId="start-view"
                  onClick={() => start(device.id, 'view')}>View</Action>
                <Action permissions={device.permissions} permission="device:control" testId="start-control"
                  onClick={() => start(device.id, 'control')}>Control</Action>
                <Action permissions={device.permissions} permission="device:terminal" testId="start-terminal"
                  onClick={() => start(device.id, 'terminal')}>Terminal</Action>
                <Action permissions={device.permissions} permission="device:file_transfer" testId="transfer-files"
                  onClick={() => setMessage('File transfer is not connected in this exercise.')}>Transfer files</Action>
                <Action permissions={device.permissions} permission="device:update" testId="rename-device"
                  onClick={() => { const name = window.prompt('Device name', device.name);
                    if (name) change(`${orgPath}/devices/${device.id}`, 'PATCH', { name }); }}>Rename</Action>
                <Action permissions={device.permissions} permission="device:provision" testId="decommission-device"
                  onClick={() => { if (window.confirm(`Decommission ${device.name}?`))
                    change(`${orgPath}/devices/${device.id}`, 'DELETE'); }}>Decommission</Action>
              </div></td></tr>)}</tbody></table></div>}
      </section>}

      {view === 'people' && <section className="panel"><div className="panel-head"><h2>People</h2>
        <Action permissions={permissions} permission="user:invite" testId="invite-user"
          onClick={() => { const email = window.prompt('Email to invite'); if (!email) return;
            const role = window.prompt('Role', 'viewer');
            if (role) change(`${orgPath}/invites`, 'POST', { email, role },
              (result) => setMessage(`Invite token: ${result.inviteToken}`)); }}>Invite</Action></div>
        <div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>{rows.map((person) => <tr key={person.id} data-testid="user-row" data-user-id={person.id}>
            <td>{person.name}</td><td>{person.email}</td><td>{person.role}</td><td>{person.status}</td>
            <td><div className="actions">{person.id !== session.user.id && <>
              {allowed('user:role:update') && <select data-testid="role-select"
                data-permission="user:role:update" data-state="unlocked" value={person.role}
                onChange={(event) => change(`${orgPath}/members/${person.id}`, 'PATCH',
                  { role: event.target.value })}>
                {(session.roles || [...new Set(rows.map((item) => item.role))]).map((role) =>
                  <option key={role} value={role}>{role}</option>)}
              </select>}
              <Action permissions={permissions} permission="user:remove" testId="suspend-user"
                onClick={() => change(`${orgPath}/members/${person.id}/suspend`,
                  person.status === 'suspended' ? 'DELETE' : 'POST')}>
                {person.status === 'suspended' ? 'Reinstate' : 'Suspend'}</Action>
              <Action permissions={permissions} permission="user:remove" testId="remove-user"
                onClick={() => { if (window.confirm(`Remove ${person.name}?`))
                  change(`${orgPath}/members/${person.id}`, 'DELETE'); }}>Remove</Action>
            </>}</div></td></tr>)}</tbody></table></div>
      </section>}

      {view === 'grants' && <Grants rows={rows} catalogue={catalogue}
        members={members.filter((member) => member.id !== session.user.id)} devices={devices}
        canCreate={allowed('grant:create')} canRevoke={allowed('grant:revoke')}
        onCreate={(body) => change(`${orgPath}/grants`, 'POST', body)}
        onRemove={(id) => change(`${orgPath}/grants/${id}`, 'DELETE')} />}

      {view === 'sessions' && <section className="panel"><div className="panel-head"><h2>Sessions</h2>
        <Action permissions={permissions} permission="session:start" testId="new-session"
          onClick={() => { const deviceId = window.prompt('Device ID'); if (!deviceId) return;
            const mode = window.prompt('Mode: view, control or terminal', 'view');
            if (mode) start(deviceId, mode); }}>New session</Action></div>
        <div className="table-wrap"><table><thead><tr><th>Device</th><th>Member</th><th>Mode</th><th>State</th><th></th></tr></thead>
          <tbody>{rows.map((item) => <tr key={item.id} data-testid="session-row">
            <td>{devices.find((device) => device.id === item.device_id)?.name || item.device_id}</td>
            <td>{item.user_id}</td><td>{item.mode}</td><td>{item.state}</td><td>
              {item.state !== 'ended' && (item.user_id === session.user.id || allowed('session:terminate')) &&
                <button data-testid="stop-session" data-permission={item.user_id === session.user.id ?
                  'self' : 'session:terminate'} data-state="unlocked"
                  onClick={() => change(`/sessions/${item.id}`, 'DELETE')}>Stop</button>}
            </td></tr>)}</tbody></table></div>
      </section>}

      {(view === 'chat' || chatOpen) && <div className={view === 'chat' ? 'chat-host-full' : 'chat-host-docked'}
        data-testid={view === 'chat' ? 'chat-full' : 'chat-dock'}>
        <Chat key={session.orgId} session={session} authed={authed} compact={view !== 'chat'}
        onClose={() => setChatOpen(false)} onExpand={() => setView('chat')}
        onMembers={allowed('user:read') ? () => setView('people') : null}
        onAuthExpired={async () => {
          try { return await refreshAccess(); }
          catch (err) {
            if (['UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND'].includes(err.code)) {
              setSession((current) => current?.orgId === session.orgId ? null : current);
            }
            throw err;
          }
        }} /></div>}

      {view === 'audit' && <section className="panel"><h2>Audit</h2>
        <div className="table-wrap"><table><thead><tr><th>When</th><th>Action</th><th>Result</th><th>Reason</th></tr></thead>
          <tbody>{rows.map((item) => <tr key={item.id} data-testid="audit-row">
            <td>{new Date(item.at).toLocaleString()}</td><td>{item.action}</td>
            <td>{item.result}</td><td>{item.reason_code || '—'}</td></tr>)}</tbody></table></div>
      </section>}

      {view === 'admin' && <section className="panel"><h2>Organization</h2>
        <p className="muted">{org?.name}</p><div className="actions">
          <Action permissions={permissions} permission="org:update" testId="rename-org"
            onClick={() => { const name = window.prompt('Organization name', org?.name);
              if (name) change(orgPath, 'PATCH', { name }, () => {
                setSession({ ...session, orgs: session.orgs.map((item) =>
                  item.id === session.orgId ? { ...item, name } : item) });
              }); }}>Rename</Action>
          <Action permissions={permissions} permission="org:delete" testId="delete-org"
            onClick={async () => { if (!window.confirm(`Delete ${org?.name}?`)) return;
              const deleted = await change(orgPath, 'DELETE');
              if (deleted) { const next = session.orgs.find((item) => item.id !== session.orgId);
                if (next) { try { enter(await api('/auth/refresh', {
                  method: 'POST', body: { orgId: next.id },
                })); } catch { setSession(null); } }
                else setSession(null); }
            }}>Delete</Action>
        </div>
      </section>}
    </main>
  </div>;
}
