import { audit, auditDenials } from '../audit.js';
import { newId, nowIso } from '../db.js';
import { badRequest, deviceBusy, forbidden, notFound, send } from '../http.js';
import { sessionExpiry, snapshotAuthority } from '../lifecycle.js';
import { assertCan, assertCanStartSession, can, resolveDevices } from '../permissions.js';

export function registerSessionRoutes(router, { db }) {
  function expireSessions(orgId) {
    db.prepare(`
      UPDATE sessions SET state = 'ended', end_reason = 'session_expired', ended_at = ?
      WHERE org_id = ? AND state IN ('connecting', 'active') AND expires_at <= ?
    `).run(nowIso(), orgId, nowIso());
  }

  const session = (id, orgId) => db.prepare(`
    SELECT * FROM sessions WHERE id = ? AND org_id = ?
  `).get(id, orgId);

  router.post('/v1/orgs/:org/sessions', (ctx, _params, res) => {
    const { deviceId, mode } = ctx.body;
    if (typeof deviceId !== 'string' || !deviceId || typeof mode !== 'string') {
      throw badRequest('deviceId and mode are required');
    }
    const device = db.prepare(`
      SELECT id FROM devices WHERE id = ? AND org_id = ? AND deleted_at IS NULL
    `).get(deviceId, ctx.orgId);
    if (!device) throw notFound();

    const meta = { action: 'session:start', targetType: 'device', targetId: deviceId };
    return auditDenials(db, ctx, meta, () => {
      assertCanStartSession(db, ctx, mode, deviceId);
      let created;
      try {
        created = db.transaction(() => {
          expireSessions(ctx.orgId);
          const id = newId('ses');
          const startedAt = nowIso();
          db.prepare(`
            INSERT INTO sessions
              (id, org_id, user_id, device_id, mode, state, authorized_by, started_at, expires_at)
            VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
          `).run(id, ctx.orgId, ctx.userId, deviceId, mode,
            JSON.stringify(snapshotAuthority(db, { userId: ctx.userId, orgId: ctx.orgId, deviceId })),
            startedAt, sessionExpiry(db, ctx.orgId, startedAt));
          audit(db, { orgId: ctx.orgId, actorId: ctx.userId, action: 'session:start',
            targetType: 'session', targetId: id, result: 'allow', requestId: ctx.requestId });
          return session(id, ctx.orgId);
        })();
      } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') throw deviceBusy();
        throw err;
      }
      send(res, 201, created);
    });
  });

  router.get('/v1/orgs/:org/sessions', (ctx, _params, res) => {
    assertCan(db, ctx, 'session:view');
    expireSessions(ctx.orgId);
    const sessions = db.prepare(`
      SELECT * FROM sessions WHERE org_id = ? ORDER BY started_at DESC
    `).all(ctx.orgId);
    const { byDevice } = resolveDevices(db, { userId: ctx.userId, orgId: ctx.orgId,
      deviceIds: [...new Set(sessions.map((row) => row.device_id))] });
    send(res, 200, { sessions: sessions.filter((row) =>
      byDevice[row.device_id]['session:view']?.effect === 'allow') });
  });

  router.get('/v1/sessions/:id', (ctx, params, res) => {
    expireSessions(ctx.orgId);
    const row = session(params.id, ctx.orgId);
    if (!row || (row.user_id !== ctx.userId &&
        !can(db, ctx, 'session:view', row.device_id))) throw notFound();
    send(res, 200, row);
  });

  router.delete('/v1/sessions/:id', (ctx, params, res) => {
    const row = session(params.id, ctx.orgId);
    if (!row) throw notFound();
    const meta = { action: 'session:stop', targetType: 'session', targetId: row.id };
    return auditDenials(db, ctx, meta, () => {
      const own = row.user_id === ctx.userId;
      if (!own && !can(db, ctx, 'session:terminate', row.device_id)) throw forbidden();
      const ended = db.transaction(() => {
        if (row.state !== 'ended') {
          db.prepare(`
            UPDATE sessions SET state = 'ended', end_reason = ?, ended_at = ?
            WHERE id = ? AND org_id = ? AND state <> 'ended'
          `).run(own ? 'user_stopped' : 'admin_terminated', nowIso(), row.id, ctx.orgId);
          audit(db, { orgId: ctx.orgId, actorId: ctx.userId, action: 'session:stop',
            targetType: 'session', targetId: row.id, result: 'allow', requestId: ctx.requestId });
        }
        return session(row.id, ctx.orgId);
      })();
      send(res, 200, ended);
    });
  });
}
