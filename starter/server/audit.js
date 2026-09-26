import { newId } from './db.js';
import { HttpError } from './http.js';

export function audit(db, { orgId, actorId, action, targetType, targetId, result, reasonCode, requestId }) {
  const id = newId('aud');
  db.prepare(`
    INSERT INTO audit_events
      (id, org_id, actor_id, action, target_type, target_id, result, reason_code, request_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, orgId, actorId ?? null, action, targetType ?? null, targetId ?? null,
    result, reasonCode ?? null, requestId ?? null);
  return id;
}

export function auditDenials(db, ctx, meta, fn) {
  const recordDenial = (err) => {
    if (err instanceof HttpError && err.status === 403) {
      audit(db, { orgId: ctx.orgId, actorId: ctx.userId,
        action: meta.action, targetType: meta.targetType, targetId: meta.targetId,
        result: 'deny', reasonCode: err.reason ?? err.code, requestId: ctx.requestId });
    }
    throw err;
  };
  try {
    const result = fn();
    return result instanceof Promise ? result.catch(recordDenial) : result;
  } catch (err) {
    return recordDenial(err);
  }
}
