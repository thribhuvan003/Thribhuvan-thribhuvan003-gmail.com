# Company chat

GameArena is the player-facing use case: a game runs on a stronger computer and is used from
another device. RhinoStream is the remote streaming and access layer behind that direction, with
room to support shared gaming and creative workstations. This chat sits beside a session so
invited teammates can coordinate playtests, 3D reviews and workstation handoffs without changing
apps. It does not carry the video or controls itself.

Built on the existing RemoteOps login, invitations and organisation memberships. The company
owner creates invitations; there is no public registration or room join endpoint. Every active
member can use their organisation's shared room. Chat doesn't grant workstation access.

Messages are saved before acknowledgement. A unique organisation/sender/client identifier makes
retrying the same send safe. Clients order messages by the database sequence and recover missed
pages after reconnecting. Drafts survive connection and token changes within the same open view;
they are not persisted after a reload. Different organisations have separate component state.

The first version could lose a send when the socket dropped, and it sorted equal timestamps by
random IDs. Added acknowledgements, pending/retry states and sequence ordering to fix both.
Loading history before subscribing could leave a gap, so the client subscribes first and merges
live messages with history by ID. Failed requests from an earlier organisation are ignored.

Security checks cover tokens, membership changes, tenant boundaries, text validation, origin
checks, per-user sending limits, frame limits and slow receivers. Suspension/removal disconnects
the member. Broadcasts recheck access as well. HTML is rendered as plain text.

Measured local delivery across 100 sockets and 50 users: 17.3 ms median, 39.0 ms maximum in the
first recorded run. This is not an internet benchmark or a claim of unlimited capacity. The server
currently accepts at most 500 sockets and 10 per member. Those are protective limits, not measured
capacity guarantees. Run `npm run test:chat:server` for a fresh isolated test and measurement.

Browser checks cover live delivery, reconnect recovery, draft preservation, mobile layout, text
escaping, invitations and removal. The original assessment behavior remains covered.

The interface uses grouped messages, a compact composer and live teammate presence. Each sender
has a stable colour derived from their user ID, used on names, avatars and message accents. Names
remain visible because colour cannot reliably distinguish everyone in a large team. Visual
references: [Slack message display](https://slack.com/help/articles/213893898-Change-how-messages-are-displayed),
[Discord accessibility](https://support.discord.com/hc/en-us/articles/1500010454681-Accessibility-Settings-Tab),
and [Dribbble team chat layouts](https://dribbble.com/search/team-chat).

Chat can dock beside Devices or Sessions. Switching between the full and compact layouts keeps
the same connection and draft. Invited-member screenshots are captured from separate browser
contexts after real invitation acceptance: an operator with an active session record and a viewer
who can chat but cannot control the machine. All participants receive the same ordered messages
and colours. This demonstrates integration with session management, not game streaming itself.

Video calls use WebRTC over the same authenticated organisation socket. Media travels directly
between browsers; the server validates membership and relays only offers, answers and ICE
candidates. Leaving, signing out, suspension, removal and connection loss remove the participant.
Camera and microphone tracks stop when the view closes. Calls are limited to six people because
this version uses a peer-to-peer mesh. Chat messages remain in SQLite and load again after sign-in;
call media is not recorded.

Localhost works with browser host candidates. A public deployment must use HTTPS and should set
`WEBRTC_ICE_SERVERS` to JSON containing its STUN and TURN servers, for example
`[{"urls":"turn:turn.example.com:3478","username":"user","credential":"secret"}]`.
TURN is needed when two networks cannot connect directly. Use short-lived TURN credentials in a
real deployment.

The grants screen is labelled Access rules. Its labels and descriptions come from the server's
runtime permission catalogue; additional permissions get a plain company-specific description.
Common-choice buttons only select actions to request. They do not decide or bypass authority.
The existing resolver still decides whether a request is allowed. The form explains device scope,
Allow/Block precedence, sensitive actions and the role access that remains after removing a rule.

Deployment uses one server and a persistent SQLite volume. Multiple replicas need a shared
database and a broker for messages, rate limits and presence. No remote desktop, game stream or
GPU capture is implemented by this feature. Sravya's available email thread has no written chat
specification;
the scope comes from the company workflow discussed here.

Redis is useful only after moving to multiple app servers, for cross-server presence, signalling,
rate limits and message fan-out. It does not reduce camera latency. A crowd call also needs an SFU
media server such as LiveKit or mediasoup and a shared production database. Adding Redis alone to
this one-server SQLite prototype would add another dependency without solving either limit.

## Live startup

`npm run start:live` requires `JWT_SECRET` and `APP_HASH_KEY` (32+ characters each). For the first
startup it also requires `OWNER_EMAIL`, `OWNER_NAME`, `OWNER_PASSWORD` (16+ characters) and
`COMPANY_NAME`. It creates a private workspace without public demo accounts. Remove the bootstrap
owner password from the hosting environment after the first successful startup.

Set `DATABASE_FILE` to a persistent volume, terminate HTTPS at the host's proxy, enable WebSocket
upgrades, and run one replica. Keep database backups. Don't use `db:reset` on live data. Global
login throttling and backup/restore operations remain deployment work before public release.

The Dockerfile builds the app and calls the live startup script. Its entrypoint prepares the
mounted data directory, then runs Node as the node user. Railway mounts volumes as root, so the
directory needs its ownership set at startup. Teamroom is live at
https://thribhuvan-chat.up.railway.app on the feature branch. HTTPS sign-in, invited-member chat,
logout/login history and two-browser video with synthetic media passed against the hosted app.
The saved chat message also survived a Railway container restart. Video across different networks
still needs TURN configuration and testing. These changes haven't been merged into the submitted
assessment branch.

The sign-in page explains personal invitations. People now returns a full link with a copy button,
the recipient and expiry. The browser check copies the actual link, opens it as another user,
accepts it, signs in, sends a chat message, and confirms reuse is rejected. Owner credentials are
not displayed publicly; each teammate uses their own account.
