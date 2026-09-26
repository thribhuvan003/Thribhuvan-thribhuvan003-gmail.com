import { assertCan, can, resolve, resolveDevices } from '../permissions.js';
import { notFound, send } from '../http.js';

const displayDevice = (device, permissions) => ({
  ...device,
  online: Boolean(device.online),
  permissions,
});

export function registerDeviceReads(router, { db }) {
  router.get('/v1/orgs/:org/devices', (ctx, _params, res) => {
    assertCan(db, ctx, 'device:list');
    const devices = db.prepare(`
      SELECT id, name, kind, online FROM devices
      WHERE org_id = ? AND deleted_at IS NULL ORDER BY name
    `).all(ctx.orgId);
    const { byDevice } = resolveDevices(db, { userId: ctx.userId, orgId: ctx.orgId,
      deviceIds: devices.map((device) => device.id) });
    send(res, 200, { devices: devices.filter((device) =>
      byDevice[device.id]['device:view']?.effect === 'allow')
      .map((device) => displayDevice(device, byDevice[device.id])) });
  });

  router.get('/v1/orgs/:org/devices/:id', (ctx, params, res) => {
    const device = db.prepare(`
      SELECT id, name, kind, online FROM devices
      WHERE id = ? AND org_id = ? AND deleted_at IS NULL
    `).get(params.id, ctx.orgId);
    if (!device || !can(db, ctx, 'device:view', device.id)) throw notFound();
    send(res, 200, displayDevice(device, resolve(db, { userId: ctx.userId,
      orgId: ctx.orgId, deviceId: device.id }).permissions));
  });
}
