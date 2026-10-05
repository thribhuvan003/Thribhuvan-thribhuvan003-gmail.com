```markdown
# RemoteOps

RemoteOps is a multi-organisation permission console for managing users, devices and remote sessions.

This project does not provide real screen sharing or terminal access. A session is stored as an authorised record for this exercise.

## Run locally

```sh
cd starter
npm install
npm run db:reset
npm run dev
```

Open `http://localhost:8080`.

For production:

```sh
npm run build
npm start
```

## What it does

- Sign in and restore a session after reload
- Create and switch organisations
- Invite, suspend, reinstate and remove members
- Change member roles
- Add, update, delete and transfer devices
- Create and revoke permission grants
- Start and end remote-session records
- Show effective permissions
- Record important actions in the audit log

## Permissions

Roles and permissions are read from SQLite.

A user can have different roles in different organisations. Permissions can apply to the whole organisation or to one device.

An applicable explicit deny wins. If no role or grant allows an action, it is denied.

The React app uses permissions returned by the API. It does not keep a separate role-permission map.

## Authentication

Access tokens are short-lived JWTs and stay in memory.

Refresh tokens are stored in an HTTP-only cookie. The server checks the current membership and permission version on authenticated requests, so outdated access tokens are rejected.

## Sessions

Starting a session requires `session:start` and the permission for its mode:

- `device:view` for view mode
- `device:control` for control mode
- `device:terminal` for terminal mode

A running session keeps the permissions it had when it started. It ends when terminated or expired. Suspension, membership removal and device transfer can also end affected sessions.

## Main files

- `starter/server/auth.js` — token and password handling
- `starter/server/context.js` — loads the current caller
- `starter/server/permissions.js` — resolves permissions
- `starter/server/lifecycle.js` — membership and session rules
- `starter/server/audit.js` — writes audit events
- `starter/server/routes/` — API endpoints
- `starter/web/App.jsx` — React console
- `DECISIONS.md` — implementation decisions
- `BUILD-LOG.md` — development notes

## Tests

Run these from `starter/`:

```sh
node scripts/check-jwt.js
node scripts/check-permissions.js
node scripts/check-personalisation.js
node scripts/check-api.js
npx playwright test
```
```
