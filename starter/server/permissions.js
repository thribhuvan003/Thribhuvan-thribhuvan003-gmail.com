import { badRequest, forbidden } from './http.js';

export const MODE_PERMISSION = { view: 'device:view', control: 'device:control', terminal: 'device:terminal' };

const matches = (pattern, permission) =>
  pattern === '*' || pattern === permission ||
  (pattern.endsWith(':*') && permission.startsWith(pattern.slice(0, -1)));

function loadState(db, { userId, orgId, now }) {
  const catalogue = db.prepare('SELECT key FROM permissions ORDER BY key').all().map((row) => row.key);
  const membership = db.prepare(`
    SELECT m.role, m.status FROM memberships m
    JOIN organizations o ON o.id = m.org_id AND o.deleted_at IS NULL
    WHERE m.user_id = ? AND m.org_id = ?
  `).get(userId, orgId);

  if (!membership || membership.status !== 'active') {
    const reason = membership?.status === 'suspended' ? 'suspended' : 'not_a_member';
    return {
      role: membership?.status === 'suspended' ? membership.role : null,
      catalogue, reason,
    };
  }

  const baseline = new Set(db.prepare('SELECT permission FROM role_permissions WHERE role = ?')
    .all(membership.role).map((row) => row.permission));
  const time = now.toISOString();
  const grants = db.prepare(`
    SELECT g.id, g.device_id, g.effect, gp.permission
    FROM grants g JOIN grant_permissions gp ON gp.grant_id = g.id
    WHERE g.user_id = ? AND g.org_id = ? AND g.revoked_at IS NULL
      AND (g.starts_at IS NULL OR g.starts_at <= ?)
      AND (g.expires_at IS NULL OR g.expires_at > ?)
    ORDER BY g.id
  `).all(userId, orgId, time, time);

  return { role: membership.role, catalogue, baseline, grants };
}

function permissionSet(state, deviceIds) {
  if (state.reason) return Object.fromEntries(state.catalogue.map((key) =>
    [key, { effect: 'deny', source: null, reason: state.reason }]));

  function atScope(permission, scope) {
    const applicable = state.grants.filter((grant) =>
      (grant.device_id === null || grant.device_id === scope) &&
      matches(grant.permission, permission));
    const denial = applicable.find((grant) => grant.effect === 'deny');
    if (denial) return { effect: 'deny', source: `grant:${denial.id}`, reason: 'explicit_deny' };
    if (state.baseline.has(permission)) {
      return { effect: 'allow', source: `role:${state.role}`, reason: null };
    }
    const allowance = applicable.find((grant) => grant.effect === 'allow');
    if (allowance) return { effect: 'allow', source: `grant:${allowance.id}`, reason: null };
    return { effect: 'deny', source: null, reason: 'implicit' };
  }

  const permissions = {};
  for (const key of state.catalogue) {
    const answers = deviceIds.map((id) => atScope(key, id));
    permissions[key] = answers.find((answer) => answer.effect === 'allow') ??
      answers.find((answer) => answer.reason === 'explicit_deny') ??
      atScope(key, null);
  }
  return permissions;
}

// Resolve from the current database rows, including the full permission catalogue.
export function resolve(db, { userId, orgId, deviceId = null, now = new Date(), orgOnly = false }) {
  const state = loadState(db, { userId, orgId, now });
  const deviceIds = state.reason || orgOnly ? [] : deviceId === null
    ? db.prepare('SELECT id FROM devices WHERE org_id = ? AND deleted_at IS NULL ORDER BY id')
      .all(orgId).map((row) => row.id)
    : [deviceId];
  return { role: state.role, permissions: permissionSet(state, deviceIds) };
}

export function resolveDevices(db, { userId, orgId, deviceIds, now = new Date() }) {
  const state = loadState(db, { userId, orgId, now });
  return { role: state.role, byDevice: Object.fromEntries(deviceIds.map((id) =>
    [id, permissionSet(state, [id])])) };
}

export function can(db, ctx, permission, deviceId = null) {
  return resolve(db, { userId: ctx.userId, orgId: ctx.orgId, deviceId })
    .permissions[permission]?.effect === 'allow';
}

export function assertCan(db, ctx, permission, deviceId = null) {
  const answer = resolve(db, { userId: ctx.userId, orgId: ctx.orgId, deviceId })
    .permissions[permission];
  if (answer?.effect !== 'allow') {
    throw forbidden('forbidden', answer?.reason === 'explicit_deny' ? 'explicit_deny' :
      answer?.reason === 'suspended' ? 'suspended' : 'missing_permission');
  }
}

export function assertMayGrant(db, ctx, patterns, deviceId = null) {
  const catalogue = db.prepare('SELECT key FROM permissions').all().map((row) => row.key);
  const requested = new Set();
  for (const pattern of patterns) {
    for (const permission of catalogue.filter((key) => matches(pattern, key))) {
      requested.add(permission);
    }
  }

  const deviceIds = deviceId === null
    ? [null, ...db.prepare('SELECT id FROM devices WHERE org_id = ? AND deleted_at IS NULL')
      .all(ctx.orgId).map((row) => row.id)]
    : [deviceId];
  for (const id of deviceIds) {
    const result = resolve(db, { userId: ctx.userId, orgId: ctx.orgId,
      deviceId: id, orgOnly: id === null });
    for (const permission of requested) {
      if (result.permissions[permission]?.effect !== 'allow') {
        throw forbidden('forbidden', 'missing_permission');
      }
    }
  }
}

export function assertCanStartSession(db, ctx, mode, deviceId) {
  if (!Object.hasOwn(MODE_PERMISSION, mode)) throw badRequest('invalid session mode');
  if (!can(db, ctx, 'session:start', deviceId)) throw forbidden('forbidden', 'missing_permission');
  if (!can(db, ctx, MODE_PERMISSION[mode], deviceId)) {
    throw forbidden('forbidden', 'missing_device_permission');
  }
}
