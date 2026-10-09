import React, { useState } from 'react';

const recipes = [
  { label: 'View a device', description: 'See the device and start a view session.',
    keys: ['device:list', 'device:view', 'session:start'] },
  { label: 'Use a device', description: 'Start a session with keyboard and mouse control.',
    keys: ['device:list', 'device:view', 'device:control', 'session:start'] },
];
const empty = () => ({ userId: '', deviceId: '', effect: 'allow', permissions: [] });

export default function Grants({ rows, members, devices, catalogue, canCreate, canRevoke, onCreate, onRemove }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(empty);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const byKey = new Map(catalogue.map((item) => [item.key, item]));
  const label = (key) => byKey.get(key)?.label ?? (key.endsWith(':*') ?
    `All ${key.split(':')[0]} actions` : key === '*' ? 'All actions' : key.split(':').join(' ').replaceAll('_', ' '));
  const groupNames = [...new Set(catalogue.map((item) => item.group))];
  const selectedMember = members.find((member) => member.id === draft.userId);
  const scope = devices.find((device) => device.id === draft.deviceId)?.name ?? 'the whole company';
  const chosen = draft.permissions.map((key) => byKey.get(key)).filter(Boolean);

  async function submit(event) {
    event.preventDefault();
    if (saving || !draft.permissions.length) return;
    setSaving(true);
    try {
      if (await onCreate({ ...draft, deviceId: draft.deviceId || null })) {
        setOpen(false); setDraft(empty());
      }
    } finally { setSaving(false); }
  }

  return <section className="panel access-panel">
    <div className="panel-head"><div><h2>Access rules</h2>
      <p className="muted access-intro">Give a teammate extra access, or block a specific action.</p></div>
      {canCreate && <button type="button" data-testid="new-grant" data-permission="grant:create"
        data-state="unlocked" onClick={() => {
          setOpen((value) => !value);
          setShowAdvanced(false);
        }}>
        {open ? 'Cancel' : 'New access rule'}</button>}
    </div>
    <div className="access-explainer"><strong>Roles provide the starting access.</strong>
      <span>Allow rules add access. Block rules take priority over Allow rules and roles.
        Removing a rule does not remove access that still comes from a role.</span></div>

    {open && <form className="access-form" onSubmit={submit}>
      <div className="access-fields">
        <label>Who is this for?<select data-testid="grant-user" value={draft.userId} required
          onChange={(event) => setDraft({ ...draft, userId: event.target.value })}>
          <option value="">Choose a teammate</option>
          {members.filter((member) => member.status === 'active').map((member) =>
            <option key={member.id} value={member.id}>{member.name}</option>)}
        </select></label>
        <label>Where does it apply?<select data-testid="grant-device" value={draft.deviceId}
          onChange={(event) => setDraft({ ...draft, deviceId: event.target.value })}>
          <option value="">Whole company · all devices</option>
          {devices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}
        </select></label>
        <label>What should this rule do?<select data-testid="grant-effect" value={draft.effect}
          onChange={(event) => {
            setDraft({ ...draft, effect: event.target.value });
            if (event.target.value === 'deny') setShowAdvanced(true);
          }}>
          <option value="allow">Allow these actions</option>
          <option value="deny">Block these actions</option>
        </select></label>
      </div>
      {draft.effect === 'allow' && <div className="access-recipes"><span>Common choices</span>
        {recipes.filter((recipe) => recipe.keys.every((key) => byKey.has(key))).map((recipe) =>
          <button type="button" key={recipe.label} onClick={() => {
            setDraft({ ...draft, permissions: recipe.keys });
            setShowAdvanced(false);
          }}>
            <strong>{recipe.label}</strong><small>{recipe.description}</small></button>)}
      </div>}
      <div className="access-custom-head">
        <p className="access-form-hint">{draft.effect === 'allow' ?
          'Choose a common option above, or select individual actions when needed.' :
          'Choose exactly what this teammate should not be able to do.'}</p>
        <button type="button" className="access-advanced-toggle" aria-expanded={showAdvanced}
          onClick={() => setShowAdvanced((value) => !value)}>
          {showAdvanced ? 'Hide individual actions' : 'Choose individual actions'}
        </button>
      </div>
      {showAdvanced && <div className="access-categories">{groupNames.map((group) => <fieldset key={group}>
        <legend>{group}</legend>
        {catalogue.filter((item) => item.group === group).map((item) => <label key={item.key} className="access-choice">
          <input type="checkbox" data-permission-key={item.key} checked={draft.permissions.includes(item.key)}
            onChange={(event) => setDraft({ ...draft, permissions: event.target.checked ?
              [...draft.permissions, item.key] : draft.permissions.filter((key) => key !== item.key) })} />
          <span><strong>{item.label}{item.sensitive && <em>Sensitive action</em>}</strong><small>{item.description}</small></span>
        </label>)}
      </fieldset>)}</div>}
      <div className={`access-preview ${draft.effect}`} aria-live="polite" data-testid="grant-preview">
        <strong>{draft.permissions.length ? `${draft.effect === 'allow' ? 'Allow' : 'Block'} ${draft.permissions.length} actions` : 'Choose at least one action'}</strong>
        <p>For {selectedMember?.name || 'a teammate'} · on {scope}.</p>
        {chosen.length > 0 && <p>{chosen.map((item) => item.label).join(', ')}.</p>}
        {draft.effect === 'deny' && <small>This Block rule wins even if a role or another rule allows these actions.</small>}
        {draft.effect === 'allow' && <small>An existing Block rule can still prevent these actions.</small>}
      </div>
      <button data-testid="grant-submit" className="primary" disabled={saving || !draft.permissions.length}>
        {saving ? 'Saving…' : 'Save access rule'}</button>
    </form>}

    <div className="table-wrap"><table><thead><tr><th>Teammate</th><th>Rule</th><th>Applies to</th><th>Actions</th><th /></tr></thead>
      <tbody>{rows.map((rule) => {
        const state = rule.revoked_at ? 'Removed' : rule.expires_at && new Date(rule.expires_at) <= new Date() ?
          'Expired' : rule.starts_at && new Date(rule.starts_at) > new Date() ? 'Scheduled' : 'Active';
        return <tr key={rule.id} data-testid="grant-row" data-effect={rule.effect}>
          <td>{rule.user_name || members.find((member) => member.id === rule.user_id)?.name || 'Former member'}</td>
          <td><span className={`access-effect ${rule.effect}`}>{rule.effect === 'allow' ? 'Allow' : 'Block'}</span>
            <small className="access-rule-state">{state}</small></td>
          <td>{rule.device_id ? rule.device_name || devices.find((device) => device.id === rule.device_id)?.name || 'Removed device' : 'Whole company · all devices'}</td>
          <td><ul className="access-rule-actions">{rule.permissions.map((key) => <li key={key}>{label(key)}</li>)}</ul></td>
          <td>{!rule.revoked_at && canRevoke && <button type="button" data-testid="revoke-grant"
            data-permission="grant:revoke" data-state="unlocked" onClick={() => onRemove(rule.id)}>Remove rule</button>}</td>
        </tr>;
      })}</tbody></table></div>
    {!rows.length && <p className="empty">No extra access rules. Members use the access provided by their roles.</p>}
  </section>;
}
