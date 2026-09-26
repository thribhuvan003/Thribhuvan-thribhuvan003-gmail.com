import { registerAuthRoutes } from './auth.js';
import { registerOrgReads } from './orgs.js';
import { registerDeviceReads } from './devices.js';
import { registerSessionRoutes } from './sessions.js';
import { registerMemberRoutes } from './members.js';
import { registerOrgWrites } from './org-writes.js';
import { registerDeviceWrites } from './device-writes.js';
import { registerGrantRoutes } from './grants.js';
import { registerInviteRoutes } from './invites.js';

export function registerRoutes(router, deps) {
  registerAuthRoutes(router, deps);
  registerOrgReads(router, deps);
  registerDeviceReads(router, deps);
  registerSessionRoutes(router, deps);
  registerMemberRoutes(router, deps);
  registerOrgWrites(router, deps);
  registerDeviceWrites(router, deps);
  registerGrantRoutes(router, deps);
  registerInviteRoutes(router, deps);
}
