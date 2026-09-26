import { registerAuthRoutes } from './auth.js';
import { registerOrgReads } from './orgs.js';
import { registerDeviceReads } from './devices.js';
import { registerSessionRoutes } from './sessions.js';

export function registerRoutes(router, deps) {
  registerAuthRoutes(router, deps);
  registerOrgReads(router, deps);
  registerDeviceReads(router, deps);
  registerSessionRoutes(router, deps);
}
