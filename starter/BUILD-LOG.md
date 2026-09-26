## Phase 0 — orientation
Setup done. `db:reset` had a Windows path issue, fixed it and DB loads fine now.
Baseline is expected — JWT, permissions and API are still stubs.
Build works. `npm start` has a Windows env issue, will fix that later.
## Phase 1 — token verification
Added token checks for format, HS256, signature, expiry, issuer, audience and jti.
`check-jwt.js`: 43/43 pass.
## Phase 2 — caller context
Bearer token now loads the current membership. Wrong org returns 404, stale token 401, suspended member 403.
Checked those cases against the seeded DB; all pass.
## Phase 3 — permissions
Resolver reads roles, permissions and grants from the DB. Deny wins, and device grants stay scoped.
`check-permissions.js`: 35/35. Personalisation: 18/18. Checked org-wide grant scope separately.
## Phase 4 — shared rules
Added role checks, last-owner guard, session ending and audit writes.
Checked them against the seeded DB in a rolled-back transaction.
## Phase 5 — auth routes
Added login, current user, org switching and refresh rotation.
Live checks passed for login, org switching, refresh and replay rejection.
## Phase 6 — read routes
Added org, member, effective permission, device and audit reads.
Live checks passed for org isolation, hidden device rows and audit access.
## Phase 7 — sessions
Added session start, list, view and stop. Each start stores an authority snapshot and expiry.
Live checks passed for compound permissions, exclusive control, expiry time and audit rows.
## Phase 8 — members
Added org creation and member role, suspend, reinstate, remove and leave routes.
Live checks passed for last owner, stale tokens and session endings.
Reinstate now refuses invited memberships; checked that separately.
## Phase 9 — org changes
Added rename and soft delete. Delete ends sessions and removes memberships.
Live checks passed; the generated DB is back to the seed state.
## Phase 10 — device changes
Added create, update, delete and transfer. Hidden devices return 404 on writes.
Checked duplicate names, cross-org access, target permissions and session end on transfer using a throwaway DB. Build, JWT, permissions and personalisation checks pass.
## Phase 11 — grants and invites
Added grant create/list/revoke and invite issue/list/revoke/accept. The grant permission FK rejects unknown names.
The first API run passed 58 checks and failed the 8 invite checks because those routes were still missing. After adding them, all 66 passed.
## Phase 12 — console
Built the org switcher and views from the permissions returned by the API. The access token stays in memory; refresh restores the page after reload.
The first UI run found a Windows dist path bug, then 3 Grants failures caused by old device rows rendering during navigation. Fixed both; 25/25 UI checks pass.
Role choices now come from the database. Sign-out revokes the refresh token; checked that it cannot be used again.
## Phase 13 — list fixes
Device permissions were being read again for every row. I shared the loaded rows across the list: 1 device took 4 queries, and 5 devices also took 4.
Sessions now use that same batch resolver. API 66/66, permissions 35/35 and personalisation 18/18 pass.
The console now shows an initial refresh network error and skips device requests when device:list is denied. UI checks passed 25/25.
## Phase 14 — run scripts
`db:reset` still used `rm` and `npm start` still used Unix env syntax. The loader already resets the DB, so the script now calls it directly. Start sets production mode in a small Node file.
Reset and build pass on Windows. `npm start` served the built index page in production mode.
