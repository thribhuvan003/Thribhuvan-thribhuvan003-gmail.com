import { assertCan, resolve } from '../permissions.js';
import { badRequest, notFound, send } from '../http.js';

export function registerOrgReads(router, { db }) {
  router.get('/v1/orgs', (ctx, _params, res) => {
    const orgs = db.prepare(`
      SELECT o.id, o.name, o.theme, m.role
      FROM memberships m JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = ? AND m.status = 'active' AND o.deleted_at IS NULL
      ORDER BY o.name
    `).all(ctx.userId);
    send(res, 200, { orgs });
  });

  router.get('/v1/orgs/:org/members', (ctx, _params, res) => {
    assertCan(db, ctx, 'user:read');
    const members = db.prepare(`
      SELECT u.id, u.name, u.email, m.role, m.status, m.joined_at
      FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.org_id = ? AND m.status <> 'removed'
      ORDER BY u.name
    `).all(ctx.orgId);
    send(res, 200, { members });
  });

  router.get('/v1/orgs/:org/users/:userId/effective', (ctx, params, res) => {
    if (params.userId !== ctx.userId) assertCan(db, ctx, 'user:read');
    const member = db.prepare(`
      SELECT 1 FROM memberships WHERE org_id = ? AND user_id = ? AND status <> 'removed'
    `).get(ctx.orgId, params.userId);
    if (!member) throw notFound();
    send(res, 200, resolve(db, { userId: params.userId, orgId: ctx.orgId }));
  });

  router.get('/v1/orgs/:org/audit', (ctx, _params, res) => {
    assertCan(db, ctx, 'audit:read');
    const readNumber = (key, fallback) => {
      const raw = ctx.query.get(key);
      if (raw === null) return fallback;
      if (!/^\d+$/.test(raw)) throw badRequest(`invalid ${key}`);
      return Number(raw);
    };
    const limit = readNumber('limit', 50);
    const offset = readNumber('offset', 0);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200 ||
        !Number.isSafeInteger(offset)) throw badRequest('invalid pagination');
    const events = db.prepare(`
      SELECT * FROM audit_events WHERE org_id = ?
      ORDER BY at DESC, id DESC LIMIT ? OFFSET ?
    `).all(ctx.orgId, limit, offset);
    send(res, 200, { events });
  });
}
