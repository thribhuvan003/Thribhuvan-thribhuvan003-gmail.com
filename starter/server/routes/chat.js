import { badRequest, send } from '../http.js';
import { chatMessage } from '../chat-store.js';

export function registerChatRoutes(router, { db }) {
  const select = `SELECT m.*, u.name AS sender_name FROM chat_messages m
    JOIN users u ON u.id = m.sender_id WHERE m.org_id = ?`;
  const older = db.prepare(`${select} AND m.seq < ? ORDER BY m.seq DESC LIMIT ?`);
  const newer = db.prepare(`${select} AND m.seq > ? ORDER BY m.seq ASC LIMIT ?`);

  router.get('/v1/orgs/:org/chat/messages', (ctx, _params, res) => {
    const limit = ctx.query.has('limit') ? Number(ctx.query.get('limit')) : 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw badRequest('limit must be an integer from 1 to 100');
    }
    const catchingUp = ctx.query.has('after');
    if (catchingUp && ctx.query.has('before')) throw badRequest('use before or after, not both');
    const raw = ctx.query.get(catchingUp ? 'after' : 'before');
    const cursor = raw === null ? Number.MAX_SAFE_INTEGER : Number(raw);
    if (!Number.isSafeInteger(cursor) || cursor < (catchingUp ? 0 : 1) || raw === '') {
      throw badRequest('invalid message cursor');
    }
    const rows = (catchingUp ? newer : older).all(ctx.orgId, cursor, limit + 1);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const nextCursor = hasMore ? page.at(-1).seq : null;
    if (!catchingUp) page.reverse();
    send(res, 200, { messages: page.map(chatMessage), nextCursor });
  });
}
