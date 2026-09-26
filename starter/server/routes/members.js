import { audit, auditDenials } from '../audit.js';
import { bumpPermVersion, newId, nowIso } from '../db.js';
import { badRequest, forbidden, notFound, selfRoleChange, send } from '../http.js';
import { assertCanModify, assertNotLastOwner, assertRoleExists,
  endActiveSessions, roleRanks } from '../lifecycle.js';
import { assertCan } from '../permissions.js';

export function registerMemberRoutes(router, { db }) {
  const member = (orgId, userId) => db.prepare(`
    SELECT * FROM memberships WHERE org_id = ? AND user_id = ?
      AND status IN ('active', 'suspended')
  `).get(orgId, userId);

  function revokeGrants(orgId, userId) {
    db.prepare(`
      UPDATE grants SET revoked_at = ?
      WHERE org_id = ? AND user_id = ? AND revoked_at IS NULL
    `).run(nowIso(), orgId, userId);
  }

  router.post('/v1/orgs', (ctx, _params, res) => {
    if (typeof ctx.body.name !== 'string') throw badRequest('invalid org name');
    const name = ctx.body.name.trim();
    if (!name || name.length > 120) throw badRequest('invalid org name');
    const id = newId('org');
    const org = db.transaction(() => {
      db.prepare('INSERT INTO organizations (id, name, theme) VALUES (?, ?, ?)')
        .run(id, name, 'cobalt');
      db.prepare(`
        INSERT INTO memberships (id, org_id, user_id, role, status, joined_at)
        VALUES (?, ?, ?, 'owner', 'active', strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      `).run(newId('mem'), id, ctx.userId);
      audit(db, { orgId: id, actorId: ctx.userId, action: 'org:create',
        targetType: 'org', targetId: id, result: 'allow', requestId: ctx.requestId });
      return { id, name, theme: 'cobalt', role: 'owner' };
    })();
    send(res, 201, org);
  });

  router.patch('/v1/orgs/:org/members/:userId', (ctx, params, res) => {
    const meta = { action: 'member:role', targetType: 'user', targetId: params.userId };
    return auditDenials(db, ctx, meta, () => {
      assertCan(db, ctx, 'user:role:update');
      const target = member(ctx.orgId, params.userId);
      if (!target) throw notFound();
      if (params.userId === ctx.userId) throw selfRoleChange();
      if (!(ctx.role === 'owner' && target.role === 'owner')) {
        assertCanModify(db, ctx.role, target.role);
      }
      const newRole = ctx.body.role;
      assertRoleExists(db, newRole);
      if (roleRanks(db)[newRole] > roleRanks(db)[ctx.role]) throw forbidden();

      const updated = db.transaction(() => {
        if (target.role !== newRole) {
          if (target.role === 'owner') assertNotLastOwner(db, ctx.orgId, params.userId);
          db.prepare('UPDATE memberships SET role = ? WHERE id = ?').run(newRole, target.id);
          bumpPermVersion(db, { orgId: ctx.orgId, userId: params.userId });
          audit(db, { orgId: ctx.orgId, actorId: ctx.userId, action: 'member:role',
            targetType: 'user', targetId: params.userId, result: 'allow', requestId: ctx.requestId });
        }
        return member(ctx.orgId, params.userId);
      })();
      send(res, 200, updated);
    });
  });

  function changeStatus(ctx, userId, status, action, reason, res) {
    const meta = { action, targetType: 'user', targetId: userId };
    return auditDenials(db, ctx, meta, () => {
      assertCan(db, ctx, 'user:remove');
      const target = member(ctx.orgId, userId);
      if (!target) throw notFound();
      if (userId === ctx.userId) throw forbidden();
      assertCanModify(db, ctx.role, target.role);
      const updated = db.transaction(() => {
        if (target.status !== status) {
          if (status !== 'active') assertNotLastOwner(db, ctx.orgId, userId);
          db.prepare('UPDATE memberships SET status = ? WHERE id = ?').run(status, target.id);
          bumpPermVersion(db, { orgId: ctx.orgId, userId });
          if (status === 'removed') revokeGrants(ctx.orgId, userId);
          if (reason) endActiveSessions(db, { orgId: ctx.orgId, userId, reason });
          audit(db, { orgId: ctx.orgId, actorId: ctx.userId, action,
            targetType: 'user', targetId: userId, result: 'allow', requestId: ctx.requestId });
        }
        return member(ctx.orgId, userId);
      })();
      send(res, 200, updated ?? { status: 'removed' });
    });
  }

  router.post('/v1/orgs/:org/members/:userId/suspend', (ctx, params, res) =>
    changeStatus(ctx, params.userId, 'suspended', 'member:suspend', 'user_suspended', res));
  router.delete('/v1/orgs/:org/members/:userId/suspend', (ctx, params, res) =>
    changeStatus(ctx, params.userId, 'active', 'member:reinstate', null, res));
  router.delete('/v1/orgs/:org/members/me', (ctx, _params, res) => {
    db.transaction(() => {
      assertNotLastOwner(db, ctx.orgId, ctx.userId);
      db.prepare(`
        UPDATE memberships SET status = 'removed', perm_version = perm_version + 1
        WHERE org_id = ? AND user_id = ? AND status = 'active'
      `).run(ctx.orgId, ctx.userId);
      revokeGrants(ctx.orgId, ctx.userId);
      endActiveSessions(db, { orgId: ctx.orgId, userId: ctx.userId,
        reason: 'membership_removed' });
      audit(db, { orgId: ctx.orgId, actorId: ctx.userId, action: 'member:leave',
        targetType: 'user', targetId: ctx.userId, result: 'allow', requestId: ctx.requestId });
    })();
    send(res, 200, { status: 'removed' });
  });
  router.delete('/v1/orgs/:org/members/:userId', (ctx, params, res) =>
    changeStatus(ctx, params.userId, 'removed', 'member:remove', 'membership_removed', res));
}
