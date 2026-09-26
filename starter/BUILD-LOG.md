## Phase 0 — orientation
### 2026-09-26
Setup done. `db:reset` had a Windows path issue, fixed it and DB loads fine now.
Baseline is expected — JWT, permissions and API are still stubs.
Build works. `npm start` has a Windows env issue, will fix that later.
## Phase 1 — token verification
### 2026-09-26
Added token checks for format, HS256, signature, expiry, issuer, audience and jti.
`check-jwt.js`: 43/43 pass.
## Phase 2 — caller context
### 2026-09-26
Bearer token now loads the current membership. Wrong org returns 404, stale token 401, suspended member 403.
Checked those cases against the seeded DB; all pass.
## Phase 3 — permissions
### 2026-09-26
Resolver reads roles, permissions and grants from the DB. Deny wins, and device grants stay scoped.
`check-permissions.js`: 35/35. Personalisation: 18/18. Checked org-wide grant scope separately.
