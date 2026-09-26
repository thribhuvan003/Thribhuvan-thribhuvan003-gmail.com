import { audit, auditDenials } from '../audit.js';
import { nowIso } from '../db.js';
import { badRequest, send } from '../http.js';
import { endActiveSessions } from '../lifecycle.js';
import { assertCan } from '../permissions.js';

export function registerOrgWrites(router, { db }) {
  router.patch('/v1/orgs/:org', (ctx, _params, res) => {
    const meta = { action: 'org:update', targetType: 'org', targetId: ctx.orgId };
    return auditDenials(db, ctx, meta, () => {
      assertCan(db, ctx, 'org:update');
      if (typeof ctx.body.name !== 'string') throw badRequest('invalid org name');
      const name = ctx.body.name.trim();
      if (!name || name.length > 120) throw badRequest('invalid org name');
      const org = db.transaction(() => {
        db.prepare('UPDATE organizations SET name = ? WHERE id = ? AND deleted_at IS NULL')
          .run(name, ctx.orgId);
        audit(db, { orgId: ctx.orgId, actorId: ctx.userId, action: 'org:update',
          targetType: 'org', targetId: ctx.orgId, result: 'allow', requestId: ctx.requestId });
        return db.prepare('SELECT id, name, theme FROM organizations WHERE id = ?').get(ctx.orgId);
      })();
      send(res, 200, org);
    });
  });

  router.delete('/v1/orgs/:org', (ctx, _params, res) => {
    const meta = { action: 'org:delete', targetType: 'org', targetId: ctx.orgId };
    return auditDenials(db, ctx, meta, () => {
      assertCan(db, ctx, 'org:delete');
      db.transaction(() => {
        endActiveSessions(db, { orgId: ctx.orgId, reason: 'membership_removed' });
        db.prepare(`
          UPDATE memberships SET status = 'removed', perm_version = perm_version + 1
          WHERE org_id = ? AND status <> 'removed'
        `).run(ctx.orgId);
        db.prepare(`
          UPDATE invites SET revoked_at = ?
          WHERE org_id = ? AND accepted_at IS NULL AND revoked_at IS NULL
        `).run(nowIso(), ctx.orgId);
        db.prepare('UPDATE organizations SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL')
          .run(nowIso(), ctx.orgId);
        audit(db, { orgId: ctx.orgId, actorId: ctx.userId, action: 'org:delete',
          targetType: 'org', targetId: ctx.orgId, result: 'allow', requestId: ctx.requestId });
      })();
      send(res, 200, { id: ctx.orgId, status: 'deleted' });
    });
  });
}
