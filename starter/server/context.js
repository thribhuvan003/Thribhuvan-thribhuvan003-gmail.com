// Turn a bearer token into the current membership for this request.
import { assertFresh, verifyAccessToken } from './auth.js';
import { forbidden, notFound, unauthenticated } from './http.js';

export function authenticate(db, secret) {
  return function buildContext(req, params) {
    const authorization = req.headers.authorization;
    const match = typeof authorization === 'string' && /^Bearer (\S+)$/i.exec(authorization);
    if (!match) throw unauthenticated();

    return contextFromToken(db, secret, match[1], params.org ?? params.orgId);
  };
}

export function contextFromToken(db, secret, token, requestedOrg) {
  const claims = verifyAccessToken(token, secret);
  if (typeof claims.sub !== 'string' || !claims.sub ||
      typeof claims.org !== 'string' || !claims.org) {
    throw unauthenticated();
  }

  if (requestedOrg !== undefined && requestedOrg !== claims.org) throw notFound();

  const membership = db.prepare(`
    SELECT m.* FROM memberships m
    JOIN organizations o ON o.id = m.org_id
    WHERE m.user_id = ? AND m.org_id = ? AND o.deleted_at IS NULL
  `).get(claims.sub, claims.org);

  if (!membership || membership.status === 'removed' || membership.status === 'invited') {
    throw unauthenticated();
  }
  if (membership.status === 'suspended') throw forbidden('forbidden', 'suspended');
  assertFresh(claims, membership);

  return {
    userId: membership.user_id,
    orgId: membership.org_id,
    role: membership.role,
    membership,
    claims,
  };
}
