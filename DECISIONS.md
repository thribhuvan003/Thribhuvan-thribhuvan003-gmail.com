# Decisions

### Read roles and permissions from SQLite
**What I chose:** `resolve()` loads the permission catalogue, role baseline and grants from the DB.
**Why:** `check-personalisation.js` passes 18/18 with a role and permission absent from `reference.sql` (commit `8bb137e`).
**What I rejected:** A JavaScript role map would pass the seed fixture but miss those extra rows.
**What would change my mind:** A fixed catalogue guaranteed across every database and migration.

### Keep one resolver for the API and device rows
**What I chose:** `resolve()` and `resolveDevices()` share `loadState()` and `permissionSet()` in `server/permissions.js`.
**Why:** The device list first loaded permissions per row. After sharing the reads, I counted 4 queries for 1 device and 4 for 5 (commit `09b8860`, Phase 13 log).
**What I rejected:** Calling `resolve()` for each device. That repeats the catalogue, membership, baseline and grant reads as the list grows.
**What would change my mind:** A measured case where the shared reads cost more than the per-row calls.

### Let an applicable deny win before the role baseline
**What I chose:** `atScope()` checks explicit denies before the baseline and allows.
**Why:** `check-permissions.js` passes 35/35, including the deny cases. The reason returned by `atScope()` is `explicit_deny` (commit `8bb137e`).
**What I rejected:** Picking the narrower grant last. An org-wide deny would then lose to a device allow.
**What would change my mind:** A required case where a device allow should survive an applicable org-wide deny.

### Check current membership on every authenticated request
**What I chose:** `authenticate()` verifies the token, matches its org to the route, then reads current membership and token version.
**Why:** Phase 2 checks covered wrong org, suspended membership and stale tokens. `check-api.js` passes 66/66 (commits `f21a180`, `b009664`).
**What I rejected:** Trusting the role inside the signed token until expiry. A removed member could keep using it.
**What would change my mind:** A revocation mechanism that invalidates the token without a DB read and passes the same cases.

### Use the database to reject unknown grant permissions
**What I chose:** Grant creation inserts permission rows in one transaction and maps the FK failure to `unknown_permission`.
**Why:** `grant_permissions.permission` has a foreign key to `permission_patterns`; `server/routes/grants.js` catches `SQLITE_CONSTRAINT_FOREIGNKEY`. The API suite passes 66/66 (commit `fab1f25`).
**What I rejected:** A second list of valid permission strings in the route. It would drift from the personalised DB.
**What would change my mind:** A permission expression that cannot be represented or checked by the schema.

### Snapshot session authority at start
**What I chose:** Session start stores the resolved permission set and an expiry; grant changes affect later starts.
**Why:** `snapshotAuthority()` and `sessionExpiry()` are used by `server/routes/sessions.js`. Phase 7 checks covered expiry and the saved authority (commit `f99cb39`).
**What I rejected:** Recomputing authority for an active session after every role or grant change. That would change an existing session midway.
**What would change my mind:** A product rule requiring live revocation of an active session after a grant change.

### Keep the access token in memory
**What I chose:** The console holds the access token in React state and uses the refresh cookie after a reload.
**Why:** UI checks passed 25/25 after the reload flow was fixed; sign-out was checked to revoke the refresh token (Phase 12, commit `c4d28e5`).
**What I rejected:** Saving the access token in local storage. A stale token could survive a reload and would add another place to clear on sign-out.
**What would change my mind:** A requirement for offline access or a different session model that makes browser persistence necessary.

### Keep setup commands cross-platform
**What I chose:** `db:reset` calls the existing idempotent loader; `npm start` runs `scripts/start.js` to set production mode.
**Why:** The original shell commands failed on Windows. After this change, reset and build pass, and `npm start` served `index.html` in production mode (Phase 14 log).
**What I rejected:** Adding another reset script. `scripts/load-db.js` already removes the database and rebuilds it.
**What would change my mind:** A loader that becomes additive instead of rebuilding the database.

## Where this repo argues with itself
`BRIEF.md` scores API 30%, UI 20%, code quality 25% and walkthrough 25%. `starter/README.md` scores code 50%, build log and decisions 30%, walkthrough 20%. I built the API and UI and kept both write-ups. The second breakdown gives the write-ups an explicit score, so I treated them as deliverables too.

`WORKFLOW.md` says a short `NOTES.md` at the repo root is enough. `starter/README.md` and `starter/DISCOVERY-BRIEF.md` name `DECISIONS.md` inside `starter/`. The hiring email requires both write-ups at the repository root, so I moved them there. Git can follow the earlier log commits through the move.

## Tools used
Codex helped implement and review the code and write-ups. I checked the behavior with the shipped JWT, permissions, personalisation, API and UI suites, and ran the app in dev and production mode.

## Deliberately not built
Email delivery, password reset and rate limiting. `starter/README.md` leaves these outside this exercise; invite tokens are returned by the API for the demo.
