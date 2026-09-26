import { badRequest, forbidden, lastOwner, notFound } from './http.js';
import { nowIso } from './db.js';
import { resolve } from './permissions.js';

export function roleRanks(db) {
  return Object.fromEntries(db.prepare('SELECT key, rank FROM roles').all()
    .map((role) => [role.key, role.rank]));
}

export function assertRoleExists(db, role) {
  if (!db.prepare('SELECT 1 FROM roles WHERE key = ?').get(role)) {
    throw badRequest('unknown role');
  }
}

export function assertCanModify(db, callerRole, targetRole) {
  assertRoleExists(db, targetRole);
  const ranks = roleRanks(db);
  if (!ranks[callerRole] || ranks[callerRole] <= ranks[targetRole]) {
    throw forbidden();
  }
}

export function assertNotLastOwner(db, orgId, userId) {
  const member = db.prepare(`
    SELECT role, status FROM memberships WHERE org_id = ? AND user_id = ?
  `).get(orgId, userId);
  if (member?.role !== 'owner' || member.status !== 'active') return;
  const owners = db.prepare(`
    SELECT count(*) AS count FROM memberships
    WHERE org_id = ? AND role = 'owner' AND status = 'active'
  `).get(orgId).count;
  if (owners <= 1) throw lastOwner();
}

export function endActiveSessions(db, { orgId, userId = null, deviceId = null, reason, exceptSessionId = null }) {
  return db.prepare(`
    UPDATE sessions SET state = 'ended', end_reason = ?, ended_at = ?
    WHERE org_id = ? AND state IN ('connecting', 'active')
      AND (? IS NULL OR user_id = ?)
      AND (? IS NULL OR device_id = ?)
      AND (? IS NULL OR id <> ?)
  `).run(reason, nowIso(), orgId, userId, userId, deviceId, deviceId,
    exceptSessionId, exceptSessionId).changes;
}

export function snapshotAuthority(db, { userId, orgId, deviceId }) {
  return resolve(db, { userId, orgId, deviceId });
}

export function sessionExpiry(db, orgId) {
  const org = db.prepare(`
    SELECT max_session_minutes FROM organizations WHERE id = ? AND deleted_at IS NULL
  `).get(orgId);
  if (!org) throw notFound();
  return new Date(Date.now() + org.max_session_minutes * 60_000).toISOString();
}
