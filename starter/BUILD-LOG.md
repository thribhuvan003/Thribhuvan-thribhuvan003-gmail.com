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
