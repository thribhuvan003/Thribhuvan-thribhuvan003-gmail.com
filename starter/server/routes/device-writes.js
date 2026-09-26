import { audit, auditDenials } from '../audit.js';
import { bumpPermVersion, newId, nowIso } from '../db.js';
import { badRequest, conflict, notFound, send } from '../http.js';
import { endActiveSessions } from '../lifecycle.js';
import { assertCan, can } from '../permissions.js';

const KINDS = new Set(['macos', 'windows', 'linux', 'android', 'ios']);

export function registerDeviceWrites(router, { db }) {
  const device = (id, orgId) => db.prepare(`
    SELECT * FROM devices WHERE id = ? AND org_id = ? AND deleted_at IS NULL
  `).get(id, orgId);

  function visibleDevice(ctx, id) {
    const row = device(id, ctx.orgId);
    if (!row || !can(db, ctx, 'device:view', row.id)) throw notFound();
    return row;
  }

  function checkName(name, orgId, exceptId = null) {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) {
      throw badRequest('invalid device name');
    }
    const duplicate = db.prepare(`
      SELECT 1 FROM devices WHERE org_id = ? AND name = ? AND deleted_at IS NULL
        AND (? IS NULL OR id <> ?)
    `).get(orgId, name.trim(), exceptId, exceptId);
    if (duplicate) throw conflict('device name already exists');
    return name.trim();
  }

  router.post('/v1/orgs/:org/devices', (ctx, _params, res) => {
    const meta = { action: 'device:create', targetType: 'org', targetId: ctx.orgId };
    return auditDenials(db, ctx, meta, () => {
      assertCan(db, ctx, 'device:provision');
      const name = checkName(ctx.body.name, ctx.orgId);
      if (!KINDS.has(ctx.body.kind)) throw badRequest('invalid device kind');
      if (ctx.body.online !== undefined && typeof ctx.body.online !== 'boolean') {
        throw badRequest('invalid online state');
      }
      const id = newId('dev');
      const created = db.transaction(() => {
        db.prepare('INSERT INTO devices (id, org_id, name, kind, online) VALUES (?, ?, ?, ?, ?)')
          .run(id, ctx.orgId, name, ctx.body.kind, ctx.body.online === true ? 1 : 0);
        audit(db, { orgId: ctx.orgId, actorId: ctx.userId, action: 'device:create',
          targetType: 'device', targetId: id, result: 'allow', requestId: ctx.requestId });
        return device(id, ctx.orgId);
      })();
      send(res, 201, { ...created, online: Boolean(created.online) });
    });
  });

  router.patch('/v1/orgs/:org/devices/:id', (ctx, params, res) => {
    const row = visibleDevice(ctx, params.id);
    const meta = { action: 'device:update', targetType: 'device', targetId: row.id };
    return auditDenials(db, ctx, meta, () => {
      assertCan(db, ctx, 'device:update', row.id);
      const name = ctx.body.name === undefined ? row.name : checkName(ctx.body.name, ctx.orgId, row.id);
      const online = ctx.body.online === undefined ? row.online :
        typeof ctx.body.online === 'boolean' ? Number(ctx.body.online) : null;
      if (online === null) throw badRequest('invalid online state');
      const updated = db.transaction(() => {
        db.prepare('UPDATE devices SET name = ?, online = ? WHERE id = ? AND org_id = ?')
          .run(name, online, row.id, ctx.orgId);
        audit(db, { orgId: ctx.orgId, actorId: ctx.userId, action: 'device:update',
          targetType: 'device', targetId: row.id, result: 'allow', requestId: ctx.requestId });
        return device(row.id, ctx.orgId);
      })();
      send(res, 200, { ...updated, online: Boolean(updated.online) });
    });
  });

  router.delete('/v1/orgs/:org/devices/:id', (ctx, params, res) => {
    const row = visibleDevice(ctx, params.id);
    const meta = { action: 'device:delete', targetType: 'device', targetId: row.id };
    return auditDenials(db, ctx, meta, () => {
      assertCan(db, ctx, 'device:provision', row.id);
      db.transaction(() => {
        endActiveSessions(db, { orgId: ctx.orgId, deviceId: row.id,
          reason: 'device_transferred' });
        db.prepare('UPDATE devices SET deleted_at = ? WHERE id = ? AND org_id = ?')
          .run(nowIso(), row.id, ctx.orgId);
        audit(db, { orgId: ctx.orgId, actorId: ctx.userId, action: 'device:delete',
          targetType: 'device', targetId: row.id, result: 'allow', requestId: ctx.requestId });
      })();
      send(res, 200, { id: row.id, status: 'deleted' });
    });
  });

  router.post('/v1/orgs/:org/devices/:id/transfer', (ctx, params, res) => {
    const row = visibleDevice(ctx, params.id);
    const targetOrgId = ctx.body.orgId;
    if (typeof targetOrgId !== 'string' || !targetOrgId || targetOrgId === ctx.orgId) {
      throw badRequest('invalid target org');
    }
    const target = db.prepare(`
      SELECT m.role FROM memberships m JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = ? AND m.org_id = ? AND m.status = 'active' AND o.deleted_at IS NULL
    `).get(ctx.userId, targetOrgId);
    if (!target) throw notFound();
    const meta = { action: 'device:transfer', targetType: 'device', targetId: row.id };
    return auditDenials(db, ctx, meta, () => {
      assertCan(db, ctx, 'device:provision', row.id);
      assertCan(db, { userId: ctx.userId, orgId: targetOrgId }, 'device:provision');
      checkName(row.name, targetOrgId);
      const moved = db.transaction(() => {
        endActiveSessions(db, { orgId: ctx.orgId, deviceId: row.id,
          reason: 'device_transferred' });
        const grantees = db.prepare(`
          SELECT DISTINCT user_id FROM grants
          WHERE org_id = ? AND device_id = ? AND revoked_at IS NULL
        `).all(ctx.orgId, row.id);
        db.prepare(`
          UPDATE grants SET revoked_at = ?
          WHERE org_id = ? AND device_id = ? AND revoked_at IS NULL
        `).run(nowIso(), ctx.orgId, row.id);
        for (const grant of grantees) {
          bumpPermVersion(db, { orgId: ctx.orgId, userId: grant.user_id });
        }
        db.prepare('UPDATE devices SET org_id = ? WHERE id = ? AND org_id = ?')
          .run(targetOrgId, row.id, ctx.orgId);
        audit(db, { orgId: ctx.orgId, actorId: ctx.userId, action: 'device:transfer',
          targetType: 'device', targetId: row.id, result: 'allow', requestId: ctx.requestId });
        return device(row.id, targetOrgId);
      })();
      send(res, 200, { ...moved, online: Boolean(moved.online) });
    });
  });
}
