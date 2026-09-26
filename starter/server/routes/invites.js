import { hashInviteToken, hashPassword, issueAccessToken, newInviteToken,
  newRefreshToken, hashRefreshToken, REFRESH_TTL_SECONDS } from '../auth.js';
import { audit, auditDenials } from '../audit.js';
import { newId, nowIso } from '../db.js';
import { badRequest, conflict, forbidden, gone, notFound, send } from '../http.js';
import { assertCan } from '../permissions.js';
import { assertRoleExists, roleRanks } from '../lifecycle.js';

const INVITE_DAYS = 7;

export function registerInviteRoutes(router, { db, secret }) {
  const invite = (token) => db.prepare(`
    SELECT i.*, o.name AS org_name FROM invites i
    JOIN organizations o ON o.id = i.org_id AND o.deleted_at IS NULL
    WHERE i.token_hash = ?
  `).get(hashInviteToken(token));

  function usable(row) {
    if (!row) throw notFound();
    if (row.accepted_at) throw conflict('invite already used');
    if (row.revoked_at || row.expires_at <= nowIso()) throw gone();
  }

  router.post('/v1/orgs/:org/invites', (ctx, _params, res) => {
    const meta = { action: 'invite:create', targetType: 'org', targetId: ctx.orgId };
    return auditDenials(db, ctx, meta, () => {
      assertCan(db, ctx, 'user:invite');
      const email = typeof ctx.body.email === 'string' ? ctx.body.email.trim().toLowerCase() : '';
      const role = ctx.body.role;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('invalid email');
      assertRoleExists(db, role);
      const ranks = roleRanks(db);
      if (!(ctx.role === 'owner' && role === 'owner') &&
          ranks[ctx.role] <= ranks[role]) throw forbidden();

      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (existing && db.prepare(`
        SELECT 1 FROM memberships WHERE org_id = ? AND user_id = ?
          AND status IN ('active', 'suspended')
      `).get(ctx.orgId, existing.id)) throw conflict('already a member');

      const raw = newInviteToken();
      const id = newId('inv');
      const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString();
      try {
        db.transaction(() => {
          db.prepare(`
            UPDATE invites SET revoked_at = ?
            WHERE org_id = ? AND email = ? AND accepted_at IS NULL
              AND revoked_at IS NULL AND expires_at <= ?
          `).run(nowIso(), ctx.orgId, email, nowIso());
          db.prepare(`
            INSERT INTO invites (id, org_id, email, role, token_hash, invited_by, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(id, ctx.orgId, email, role, hashInviteToken(raw), ctx.userId, expiresAt);
          if (existing) {
            db.prepare(`
              UPDATE memberships SET role = ?, status = 'invited', invited_by = ?,
                perm_version = perm_version + 1
              WHERE org_id = ? AND user_id = ? AND status IN ('removed', 'invited')
            `).run(role, ctx.userId, ctx.orgId, existing.id);
          }
          audit(db, { orgId: ctx.orgId, actorId: ctx.userId, action: 'invite:create',
            targetType: 'invite', targetId: id, result: 'allow', requestId: ctx.requestId });
        })();
      } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') throw conflict('live invite already exists');
        throw err;
      }
      send(res, 201, { id, email, role, expiresAt, inviteToken: raw });
    });
  });

  router.get('/v1/orgs/:org/invites', (ctx, _params, res) => {
    assertCan(db, ctx, 'user:invite');
    const invites = db.prepare(`
      SELECT id, email, role, expires_at, accepted_at, revoked_at, created_at
      FROM invites WHERE org_id = ? ORDER BY created_at DESC
    `).all(ctx.orgId);
    send(res, 200, { invites });
  });

  router.delete('/v1/orgs/:org/invites/:id', (ctx, params, res) => {
    const row = db.prepare(`
      SELECT * FROM invites WHERE id = ? AND org_id = ?
        AND accepted_at IS NULL AND revoked_at IS NULL
    `).get(params.id, ctx.orgId);
    if (!row) throw notFound();
    const meta = { action: 'invite:revoke', targetType: 'invite', targetId: row.id };
    return auditDenials(db, ctx, meta, () => {
      assertCan(db, ctx, 'user:invite');
      db.transaction(() => {
        db.prepare('UPDATE invites SET revoked_at = ? WHERE id = ?')
          .run(nowIso(), row.id);
        audit(db, { orgId: ctx.orgId, actorId: ctx.userId, action: 'invite:revoke',
          targetType: 'invite', targetId: row.id, result: 'allow', requestId: ctx.requestId });
      })();
      send(res, 200, { id: row.id, status: 'revoked' });
    });
  });

  router.get('/v1/invites/:token', (_ctx, params, res) => {
    const row = invite(params.token);
    usable(row);
    res.setHeader('referrer-policy', 'no-referrer');
    send(res, 200, { orgName: row.org_name, role: row.role,
      email: row.email, expiresAt: row.expires_at });
  });

  router.post('/v1/invites/:token/accept', (ctx, params, res) => {
    const row = invite(params.token);
    usable(row);
    const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(row.email);
    const name = typeof ctx.body.name === 'string' ? ctx.body.name.trim() : '';
    const password = ctx.body.password;
    if (!existing && (!name || name.length > 120 ||
        typeof password !== 'string' || password.length < 8)) {
      throw badRequest('name and password are required');
    }

    let user;
    const rawRefresh = newRefreshToken();
    db.transaction(() => {
      const changed = db.prepare(`
        UPDATE invites SET accepted_at = ?
        WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?
      `).run(nowIso(), row.id, nowIso()).changes;
      if (!changed) throw conflict('invite already used');
      user = existing;
      if (!user) {
        user = { id: newId('usr'), email: row.email, name };
        db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)')
          .run(user.id, user.email, user.name, hashPassword(password));
      }
      const member = db.prepare(`
        SELECT status FROM memberships WHERE org_id = ? AND user_id = ?
      `).get(row.org_id, user.id);
      if (member?.status === 'active' || member?.status === 'suspended') {
        throw conflict('already a member');
      }
      if (member) {
        db.prepare(`
          UPDATE memberships SET status = 'active', role = ?, invited_by = ?,
            joined_at = ?, perm_version = perm_version + 1
          WHERE org_id = ? AND user_id = ?
        `).run(row.role, row.invited_by, nowIso(), row.org_id, user.id);
      } else {
        db.prepare(`
          INSERT INTO memberships
            (id, org_id, user_id, role, status, invited_by, joined_at)
          VALUES (?, ?, ?, ?, 'active', ?, ?)
        `).run(newId('mem'), row.org_id, user.id, row.role, row.invited_by, nowIso());
      }
      db.prepare('UPDATE invites SET accepted_by = ? WHERE id = ?').run(user.id, row.id);
      db.prepare(`
        INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(newId('rt'), user.id, hashRefreshToken(rawRefresh), newId('fam'),
        new Date(Date.now() + REFRESH_TTL_SECONDS * 1000).toISOString());
      audit(db, { orgId: row.org_id, actorId: user.id, action: 'invite:accept',
        targetType: 'invite', targetId: row.id, result: 'allow', requestId: ctx.requestId });
    })();

    const membership = db.prepare(`
      SELECT role, perm_version FROM memberships WHERE org_id = ? AND user_id = ?
    `).get(row.org_id, user.id);
    res.setHeader('set-cookie',
      `rt=${rawRefresh}; Path=/v1/auth; HttpOnly; SameSite=Strict; Secure; Max-Age=${REFRESH_TTL_SECONDS}`);
    send(res, 200, { token: issueAccessToken({ userId: user.id, orgId: row.org_id,
      role: membership.role, permVersion: membership.perm_version }, secret),
      user: { id: user.id, email: user.email, name: user.name },
      orgId: row.org_id, role: membership.role });
  });
}
