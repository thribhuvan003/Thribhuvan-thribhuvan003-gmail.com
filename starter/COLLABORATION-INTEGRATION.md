# Team chat and calls: integration guide

The implementation is on `feat/org-chat`. It extends the existing RemoteOps application with React UI, a Node HTTP/WebSocket server and persistent SQLite message storage. It is not the proposed Go/LiveKit prototype. Remote desktop capture and streaming remain outside this feature.

## What the host application supplies

Keep a single `Chat` instance mounted for the active organisation. Its `session` includes `orgId`, `token`, `user` and `orgs`; `authed(path)` uses the host's authenticated API client and `onAuthExpired()` refreshes the session. `onMembers`, `onFloat`, `onClose`, `onExpand` and `onUnreadChange` connect the feature to host navigation. `hidden` hides chat without ending the call; `compact` selects the floating view. Signing out or switching organisation unmounts the organisation's instance and stops its media tracks.

`useChat` connects to same-origin `/v1/chat/socket` with an authentication packet and loads messages from `/v1/orgs/:orgId/chat/messages`. Preserve the server membership checks, history sequencing and acknowledgement contract when adapting those endpoints. The host's existing login is authoritative; receiving an invite or joining a call does not grant workstation access.

`useVideoCall` uses the authenticated chat connection for signalling. Media flows between browsers using WebRTC. The six-person limit is intentional for this peer-to-peer mesh. Larger calls require a separate SFU architecture; adding participants to the UI alone is insufficient.

`FloatingWindow` owns layout state independently of the chat/call hooks. Moving, resizing, maximising and minimising change presentation without recreating connections. Video remains mounted when minimised, so received audio continues. Close chat hides it; close video leaves the call. Arrow keys move the titlebar or resize with the resize handle; Shift uses a larger step. Home resets position. Double-clicking the titlebar maximises/restores. The chat Expand action docks it into the host page, separate from maximising the floating window.

## Deployment contract

- HTTPS and WebSocket upgrades on the same origin; camera/microphone permissions are requested by the browser.
- Persistent `DATABASE_FILE` and one app replica. Multiple replicas require shared message storage, signalling/presence and rate limits.
- Set `JWT_SECRET` and `APP_HASH_KEY` and follow `CHAT-NOTES.md` for private owner bootstrap. Do not run `db:reset` on production data.
- Set `WEBRTC_ICE_SERVERS` with the deployment's STUN/TURN service. Keep credentials outside Git and use short-lived TURN credentials in production.
- Disable `PUBLIC_OWNER_LOGIN` for a private deployment. Rotate any previously shared owner password before using that account for private company data.

There is no evidence yet that this module can be inserted unchanged into Gamearena's production application. Their authentication, routing, CSS and signalling interfaces must be mapped and tested. The React components and documented protocol are the handoff, not a claim of compatibility with unseen code.

## Review and verification

Use Node 22 (matching the Docker image):

```sh
npm ci
npx playwright install --with-deps chromium
npm run test:chat:server
npm test
```

`npm test` builds first and runs against the real server with a disposable database. GitHub Actions repeats the authentication, permission, server and browser checks on feature-branch pushes and pull requests.

Browser checks use synthetic media. Before production release, also test real cameras/microphones on supported Chrome, Safari and Firefox versions; separate devices on Wi-Fi/mobile networks; forced TURN relay; permission denial; device removal; and backgrounding/returning on mobile. Local automation is not a substitute for those checks. No new screen-sharing or device-selection UI is part of this polish pass.

## Design and browser references

- [Zuum video conference dashboard — Nami / Nija Works](https://dribbble.com/shots/19531357-Zuum-Video-Conference-Dashboard): reference for separated participant, conversation and call-control regions. Artwork is not copied into this application.
- [Floating chat UI references](https://dribbble.com/search/floating-chat-ui): reference for compact overlays; the existing green/neutral design language is retained.
- [W3C target size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html): larger pointer/touch targets and keyboard alternatives.
- [MDN VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport): fit windows to the visible viewport, including resize/scroll events and viewport offsets.
- [MDN media track ended event](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/ended_event): show device-loss feedback and avoid pretending an ended track can be unmuted.

These references support specific layout and interaction decisions; they do not certify accessibility or production readiness.

## Verified polish pass — 10 October 2026

The production build, all 42 browser checks, all 9 chat/server checks and all 66 API assertions passed locally. JWT, runtime permissions and personalisation checks also passed. Browser review covered desktop floating chat/calls, mobile chat and a 390×360 maximised window. The call regression checks actual video readiness and increasing inbound audio RTP, not just the presence of video elements; participant labels must stay inside the resized video grid.

This execution environment used Node 22.16 and Chrome Headless Shell 131 with environment-only launch settings (`--no-zygote`, loopback ICE and local-IP discovery settings) because Unix sockets/network discovery are restricted here. Those settings are not shipped to end users and do not bypass the app's authentication. The committed CI uses Playwright's normal Chromium installation. Cross-network TURN, real hardware and Safari/Firefox validation remain unverified.
