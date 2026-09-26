import { audit, auditDenials } from '../audit.js';
import { bumpPermVersion, newId, nowIso } from '../db.js';
import { badRequest, forbidden, HttpError, normalizeTs, notFound, send } from '../http.js';
import { assertCan, assertMayGrant } from '../permissions.js';

export function registerGrantRoutes(router, { db }) {
  router.post('/v1/orgs/:org/grants', (ctx, _params, res) => {
    const meta = { action: 'grant:create', targetType: 'user', targetId: ctx.body.userId };
    return auditDenials(db, ctx, meta, () => {
      assertCan(db, ctx, 'grant:create');
      const { userId, deviceId = null, effect, permissions } = ctx.body;
      if (typeof userId !== 'string' || !userId ||
          !['allow', 'deny'].includes(effect) ||
          !Array.isArray(permissions) || permissions.length === 0 ||
          permissions.some((item) => typeof item !== 'string' || !item)) {
        throw badRequest('invalid grant');
      }
      if (userId === ctx.userId) throw forbidden('cannot grant to yourself');
      const member = db.prepare(`
        SELECT 1 FROM memberships WHERE org_id = ? AND user_id = ? AND status = 'active'
      `).get(ctx.orgId, userId);
      if (!member) throw notFound();
      if (deviceId !== null) {
        if (typeof deviceId !== 'string' || !db.prepare(`
          SELECT 1 FROM devices WHERE id = ? AND org_id = ? AND deleted_at IS NULL
        `).get(deviceId, ctx.orgId)) throw notFound();
      }
      const startsAt = normalizeTs(ctx.body.startsAt, 'startsAt');
      const expiresAt = normalizeTs(ctx.body.expiresAt, 'expiresAt');
      if (expiresAt && expiresAt <= nowIso()) {
        throw new HttpError(400, 'GRANT_EXPIRED', 'grant has already expired', 'expired_grant');
      }
      if (startsAt && expiresAt && expiresAt <= startsAt) {
        throw badRequest('expiry must be after start');
      }
      assertMayGrant(db, ctx, permissions, deviceId);
      const id = newId('grt');
      try {
        db.transaction(() => {
          db.prepare(`
            INSERT INTO grants
              (id, org_id, user_id, device_id, effect, starts_at, expires_at, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(id, ctx.orgId, userId, deviceId, effect, startsAt, expiresAt, ctx.userId);
          const insert = db.prepare(`
            INSERT OR IGNORE INTO grant_permissions (grant_id, permission) VALUES (?, ?)
          `);
          for (const permission of permissions) insert.run(id, permission);
          bumpPermVersion(db, { orgId: ctx.orgId, userId });
          audit(db, { orgId: ctx.orgId, actorId: ctx.userId, action: 'grant:create',
            targetType: 'grant', targetId: id, result: 'allow', requestId: ctx.requestId });
        })();
      } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
          throw badRequest('unknown permission', 'unknown_permission');
        }
        throw err;
      }
      send(res, 201, { id, userId, deviceId, effect,
        permissions: [...new Set(permissions)], startsAt, expiresAt });
    });
  });

  router.get('/v1/orgs/:org/grants', (ctx, _params, res) => {
    assertCan(db, ctx, 'user:read');
    const grants = db.prepare(`
      SELECT * FROM grants WHERE org_id = ? ORDER BY created_at DESC, id DESC
    `).all(ctx.orgId);
    const parts = db.prepare(`
      SELECT gp.grant_id, gp.permission FROM grant_permissions gp
      JOIN grants g ON g.id = gp.grant_id WHERE g.org_id = ?
      ORDER BY gp.permission
    `).all(ctx.orgId);
    const byGrant = new Map(grants.map((grant) => [grant.id, []]));
    for (const part of parts) byGrant.get(part.grant_id).push(part.permission);
    send(res, 200, { grants: grants.map((grant) =>
      ({ ...grant, permissions: byGrant.get(grant.id) })) });
  });

  router.delete('/v1/orgs/:org/grants/:id', (ctx, params, res) => {
    const grant = db.prepare(`
      SELECT * FROM grants WHERE id = ? AND org_id = ? AND revoked_at IS NULL
    `).get(params.id, ctx.orgId);
    if (!grant) throw notFound();
    const meta = { action: 'grant:revoke', targetType: 'grant', targetId: grant.id };
    return auditDenials(db, ctx, meta, () => {
      assertCan(db, ctx, 'grant:revoke');
      db.transaction(() => {
        db.prepare('UPDATE grants SET revoked_at = ? WHERE id = ? AND org_id = ?')
          .run(nowIso(), grant.id, ctx.orgId);
        bumpPermVersion(db, { orgId: ctx.orgId, userId: grant.user_id });
        audit(db, { orgId: ctx.orgId, actorId: ctx.userId, action: 'grant:revoke',
          targetType: 'grant', targetId: grant.id, result: 'allow', requestId: ctx.requestId });
      })();
      send(res, 200, { id: grant.id, status: 'revoked' });
    });
  });
}
