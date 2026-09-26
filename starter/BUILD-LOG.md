## Phase 0 — orientation
### 2026-09-26
Setup done. `db:reset` had a Windows path issue, fixed it and DB loads fine now.
Baseline is expected — JWT, permissions and API are still stubs.
Build works. `npm start` has a Windows env issue, will fix that later.
## Phase 1 — token verification
### 2026-09-26
Added token checks for format, HS256, signature, expiry, issuer, audience and jti.
`check-jwt.js`: 43/43 pass.
