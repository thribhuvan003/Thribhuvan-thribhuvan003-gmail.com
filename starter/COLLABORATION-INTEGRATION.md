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

Browser checks use synthetic media. Before production release, also test real cameras/microphones on supported Chrome, Safari and Firefox versions; separate devices on Wi-Fi/mobile networks; forced TURN relay; permission denial; device removal; and backgrounding/returning on mobile. Local automation is not a substitute for those checks. Device selection is not yet implemented.

## Call entry and screen sharing

Opening Start call / Join call displays a keyboard-accessible native dialog. It requests no devices until Join call is selected. Users choose video and audio, or microphone-only, and can join muted. Muting is applied before attaching audio to any peer. Cancel and Escape invalidate pending permission requests; late streams are stopped. Audio-only calls do not request camera permission, but can receive video and present a screen. To add a camera to an audio-only call, leave and rejoin with video.

Share screen invokes the browser's `getDisplayMedia` chooser from a user action. The selected display track replaces the existing video sender, rather than adding a second outgoing stream for every mesh peer. The microphone continues; screen/system audio is not captured in this version. The local screen preview is not mirrored. Presenting tiles expand across the grid, with a sharing badge visible to teammates. Camera transmission resumes in its previous enabled/disabled state when sharing stops. The camera capture track remains reserved during presentation so it can be restored without another permission prompt.

Both Stop sharing and the browser's own stop control end capture. Leaving, signing out or switching organisation stops camera, microphone and display tracks. A display stream returned after leaving is immediately stopped. New peers use the current screen source, and reserved video transceivers allow audio-only members to present as either offerer or answerer. Deploy the updated client and server together: the optional boolean `sharing` field extends the existing validated `media` signal; older packets without that field remain accepted.

Capture requests target 1080p and 15 fps, with a 30 fps ceiling and a detail content hint for readable reviews. Browsers and networks determine actual quality and latency. Screen sharing is available only where `getDisplayMedia` is supported and permitted; unsupported browsers show a disabled control with an explanation. This is collaborative screen viewing, not remote computer control.

### Product priorities after this pass

| Priority | Improvement | Acceptance evidence |
| --- | --- | --- |
| 1 | Real-device and cross-network release validation | Native screen chooser/OS permissions, camera restore, TURN relay and 2–6 people on separate networks; measure call latency, frame drops, CPU and bandwidth |
| 2 | Camera/microphone picker and local preview | Switch devices without losing a call; handle unplugging and permission changes |
| 3 | Connection quality and controlled recovery | Show useful network feedback, validate ICE restart without offer collisions, and test Wi-Fi/mobile transitions |
| 4 | Chat search and unread navigation | Find earlier decisions with organisation-scoped, paginated server search; preserve drafts and reading position |
| 5 | Larger meeting architecture | SFU design and load measurements before increasing the six-person mesh limit |

These are ordered engineering recommendations from this repository review, not implemented features or a promise of zero latency.

## Design and browser references

- [Zuum video conference dashboard — Nami / Nija Works](https://dribbble.com/shots/19531357-Zuum-Video-Conference-Dashboard): reference for separated participant, conversation and call-control regions. Artwork is not copied into this application.
- [Floating chat UI references](https://dribbble.com/search/floating-chat-ui): reference for compact overlays; the existing green/neutral design language is retained.
- [W3C target size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html): larger pointer/touch targets and keyboard alternatives.
- [MDN VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport): fit windows to the visible viewport, including resize/scroll events and viewport offsets.
- [MDN media track ended event](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/ended_event): show device-loss feedback and avoid pretending an ended track can be unmuted.
- [Google Meet: connect your video and audio](https://support.google.com/meet/answer/10409699?hl=en): reference for giving users control before joining. Our join choices do not yet provide Meet's device picker or preview.
- [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia): request microphone-only with `video: false`; treat pending/denied permission as a recoverable state.
- [MDN getDisplayMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia): browser-controlled source selection, user activation and capture lifecycle.
- [MDN replaceTrack](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpSender/replaceTrack): replace an existing sender's video source, with rollback if replacement fails.
- [MDN addTransceiver](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/addTransceiver): reserve a video direction for audio-only participants.
- [MDN transceiver direction](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpTransceiver/direction): configure the negotiated video transceiver before generating the answer, so presentation can send as well as receive.

These references support specific layout and interaction decisions; they do not certify accessibility or production readiness.

## Verified polish pass — 10 October 2026

The production build, all 42 browser checks, all 9 chat/server checks and all 66 API assertions passed locally. JWT, runtime permissions and personalisation checks also passed. Browser review covered desktop floating chat/calls, mobile chat and a 390×360 maximised window. The call regression checks actual video readiness and increasing inbound audio RTP, not just the presence of video elements; participant labels must stay inside the resized video grid.

This execution environment used Node 22.16 and Chrome Headless Shell 131 with environment-only launch settings (`--no-zygote`, loopback ICE and local-IP discovery settings) because Unix sockets/network discovery are restricted here. Those settings are not shipped to end users and do not bypass the app's authentication. The committed CI uses Playwright's normal Chromium installation. Cross-network TURN, real hardware and Safari/Firefox validation remain unverified.

## Verified call entry and sharing pass — 10 October 2026

The production build, all 47 browser checks, all 9 chat/server checks and all 66 API assertions passed locally. Screen regression checks use a synthetic canvas capture over real browser-to-browser WebRTC: remote pixels must match the shared source, inbound microphone RTP must keep increasing, and audio-only members must be able to present as both offerer and answerer. Tests also cover camera sender restoration, window minimise/maximise while presenting, browser Stop sharing, sender replacement failure and recovery, cancelled/late permission responses, start-muted tracks before peer attachment, a short-screen join dialog, and unsupported screen capture. The server checks validate the optional sharing state and reject malformed values without weakening organisation isolation.

The native OS/browser screen chooser is not driven by these tests, and screen/system audio is intentionally excluded. Test native window/tab/display selection, OS screen-recording permissions, real hardware, 2–6 participants, mobile viewers, network transitions and forced TURN before release. No end-to-end latency or zero-lag claim follows from the local synthetic-media checks. Deploy client and signalling server together; the existing six-person mesh and one-server deployment limits still apply.
