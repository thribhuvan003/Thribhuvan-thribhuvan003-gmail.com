import { issueAccessToken, verifyPassword, newRefreshToken, hashRefreshToken,
  REFRESH_TTL_SECONDS } from '../auth.js';
import { newId, nowIso } from '../db.js';
import { badRequest, notFound, send, unauthenticated } from '../http.js';
import { resolve } from '../permissions.js';

export function registerAuthRoutes(router, { db, secret }) {
  const publicEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const publicPassword = process.env.OWNER_PASSWORD;
  const publicOwner = process.env.PUBLIC_OWNER_LOGIN === 'true' && publicEmail && publicPassword
    ? db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(publicEmail) : null;
  const publicLogin = publicOwner && verifyPassword(publicPassword, publicOwner.password_hash)
    ? { email: publicEmail, password: publicPassword } : null;

  router.get('/v1/demo-login', (_ctx, _params, res) => {
    res.setHeader('cache-control', 'no-store');
    const active = publicLogin && db.prepare(`SELECT o.id FROM memberships m
      JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = ? AND m.role = 'owner' AND m.status = 'active'
        AND o.deleted_at IS NULL ORDER BY o.name LIMIT 1`).get(publicOwner.id);
    send(res, 200, active ? { enabled: true, ...publicLogin, orgId: active.id } : { enabled: false });
  });

  const memberships = (userId) => db.prepare(`
    SELECT o.id, o.name, o.theme, m.role, m.perm_version
    FROM memberships m JOIN organizations o ON o.id = m.org_id
    WHERE m.user_id = ? AND m.status = 'active' AND o.deleted_at IS NULL
    ORDER BY o.name
  `).all(userId);
  const roles = () => db.prepare('SELECT key FROM roles ORDER BY rank DESC')
    .all().map((row) => row.key);

  function answer(user, orgs, org) {
    return {
      token: issueAccessToken({ userId: user.id, orgId: org.id,
        role: org.role, permVersion: org.perm_version }, secret),
      user: { id: user.id, email: user.email, name: user.name },
      orgId: org.id,
      role: org.role,
      roles: roles(),
      orgs: orgs.map(({ id, name, theme, role }) => ({ id, name, theme, role })),
      permissions: resolve(db, { userId: user.id, orgId: org.id }).permissions,
    };
  }

  function setRefreshCookie(res, raw) {
    res.setHeader('set-cookie',
      `rt=${raw}; Path=/v1/auth; HttpOnly; SameSite=Strict; Secure; Max-Age=${REFRESH_TTL_SECONDS}`);
  }

  router.post('/v1/auth/login', (ctx, _params, res) => {
    const { email, password, orgId } = ctx.body;
    if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
      throw badRequest('email and password are required');
    }
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw unauthenticated('invalid credentials');
    }
    const orgs = memberships(user.id);
    const org = orgId ? orgs.find((row) => row.id === orgId) : orgs[0];
    if (!org) throw notFound();

    const raw = newRefreshToken();
    db.prepare(`
      INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(newId('rt'), user.id, hashRefreshToken(raw), newId('fam'),
      new Date(Date.now() + REFRESH_TTL_SECONDS * 1000).toISOString());
    setRefreshCookie(res, raw);
    send(res, 200, answer(user, orgs, org));
  });

  router.post('/v1/auth/refresh', (ctx, _params, res) => {
    const raw = ctx.req.headers.cookie?.split(';').map((part) => part.trim())
      .find((part) => part.startsWith('rt='))?.slice(3);
    if (!raw) throw unauthenticated();
    const old = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?')
      .get(hashRefreshToken(raw));
    if (!old) throw unauthenticated();
    if (old.revoked_at) {
      db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL')
        .run(nowIso(), old.family_id);
      throw unauthenticated();
    }
    if (old.expires_at <= nowIso()) throw unauthenticated();

    const user = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(old.user_id);
    const orgs = memberships(user.id);
    const org = ctx.body.orgId ? orgs.find((row) => row.id === ctx.body.orgId) : orgs[0];
    if (!org) throw notFound();

    const next = newRefreshToken();
    db.transaction(() => {
      const changed = db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
        .run(nowIso(), old.id).changes;
      if (!changed) throw unauthenticated();
      db.prepare(`
        INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(newId('rt'), user.id, hashRefreshToken(next), old.family_id,
        new Date(Date.now() + REFRESH_TTL_SECONDS * 1000).toISOString());
    })();
    setRefreshCookie(res, next);
    send(res, 200, answer(user, orgs, org));
  });

  router.post('/v1/auth/token', (ctx, _params, res) => {
    const orgs = memberships(ctx.userId);
    const org = orgs.find((row) => row.id === ctx.body.orgId);
    if (!org) throw notFound();
    const user = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(ctx.userId);
    send(res, 200, answer(user, orgs, org));
  });

  router.post('/v1/auth/logout', (ctx, _params, res) => {
    const raw = ctx.req.headers.cookie?.split(';').map((part) => part.trim())
      .find((part) => part.startsWith('rt='))?.slice(3);
    if (raw) db.prepare(`
      UPDATE refresh_tokens SET revoked_at = ?
      WHERE token_hash = ? AND revoked_at IS NULL
    `).run(nowIso(), hashRefreshToken(raw));
    res.setHeader('set-cookie',
      'rt=; Path=/v1/auth; HttpOnly; SameSite=Strict; Secure; Max-Age=0');
    send(res, 200, { status: 'signed_out' });
  });

  router.get('/v1/auth/me', (ctx, _params, res) => {
    const user = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(ctx.userId);
    const orgs = memberships(ctx.userId);
    const org = orgs.find((row) => row.id === ctx.orgId);
    if (!org) throw unauthenticated();
    send(res, 200, { user: { id: user.id, email: user.email, name: user.name },
      orgId: org.id, role: org.role,
      roles: roles(),
      orgs: orgs.map(({ id, name, theme, role }) => ({ id, name, theme, role })),
      permissions: resolve(db, { userId: ctx.userId, orgId: ctx.orgId }).permissions });
  });
}
