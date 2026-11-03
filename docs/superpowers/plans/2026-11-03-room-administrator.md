# Room administrator implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one room Administrator whom the Owner can appoint, revoke, and prefer as successor.

**Architecture:** Extend the existing room state and negotiated WebSocket protocol. Authorization remains server-side; the client uses the new role state to show the approved menu and controls. Preserve current Owner reconnection grace and fallback succession.

**Tech Stack:** Rust 1.88 server, vanilla JavaScript Jellyfin client, Node tests, Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-11-03-room-administrator-design.md`

## Global Constraints

- One Administrator per room, tied to a nonempty authenticated Jellyfin user ID. Owner may revoke then appoint another.
- `Owner` and `Administrador` are room labels, not Jellyfin account permissions.
- Owner has the current 10-second disconnect recovery period. Connected Administrator succeeds first; otherwise use existing selection.
- Only Owner assigns/revokes. Administrator controls playback/queue and moderates guests, but cannot manage roles, close room, transfer ownership, or moderate Owner.
- Backward compatibility via negotiated `room_administrator` feature; legacy `participant_list` shape must remain valid.
- UI follows `owp-pr/render-172/172-admin-{menu,confirm,assigned,remove}.png`; `⋯` retains Quitar/Bloquear and gets role action. Use person-with-× for Quitar.
- #171, #173 and #221 are open dependencies. Do not silently roll their unrelated commits into the PR; use an explicitly stacked branch or integration worktree and explain the dependency.

## Review Focus

- Two Owner requests racing to assign different Administrators: exactly one succeeds; Task 2 test.
- Two connections for one Jellyfin user: both see the role, but succession picks one connection; Tasks 1 and 3 tests.
- Owner blocks/revokes the Administrator while reconnecting: no stale privilege or future succession; Tasks 2 and 3 tests.
- Old client during role change: no malformed `participant_list` and no role escalation; Tasks 1 and 2 tests.
- Administrator tries to block an alternate Owner connection: server rejects by account identity; Task 4 test.

---

## File map and dependency setup

Server: `src/server/src/types.rs` owns role state and message types; `room/participants.rs` emits role state; `room/leave.rs` handles succession; `ws/handlers/administrator.rs` validates role changes; existing playback, queue, moderation and close handlers use a shared room authorization helper. Client: `state.js`, WebSocket handler/dispatch, `ui/participants.js`, `ui/styles.js`, `utils/i18n.js`. Protocol: `docs/src/content/docs/technical/protocol.md`. Tests live beside these modules, in `src/clients/jellyfin-web/tests/`, and `e2e/tests/room-administrator.spec.js`.

### Task 1: Integrate dependencies and role state

**Interfaces:** Add `Room.administrator_user_id: Option<String>` and helper `room::role_of(room: &Room, client: &Client) -> RoomRole` with Owner, Administrator, Guest. Add negotiated feature `room_administrator` and a role-state message containing user identity only for supporting clients.

- [ ] Establish an integration base containing current #171, #173 and #221, resolving only overlap needed by #172. Record exact commit IDs. Run baseline Rust and JS tests; investigate any failures before feature code.
- [ ] Write failing Rust tests: role by user ID across two connections, empty identity not eligible, old client sees unchanged `participant_list`.
- [ ] Implement role state and negotiated message, reusing feature dispatch patterns.
- [ ] Run focused Rust tests and JS protocol tests; require pass.
- [ ] Commit dependency resolution separately from role changes, then role state and tests.

### Task 2: Assign or revoke exactly one Administrator

**Interfaces:** `set_room_administrator { participant_id, enabled }` from Owner; server resolves participant to account and emits updated role state. Error for wrong role, bad target, full slot, or stale participant.

- [ ] Write failing handler tests for Owner grant/revoke, guest/admin denial, second grant denial, simultaneous grants, invalid ID, untrusted/empty identity and stale request.
- [ ] Run focused tests; confirm expected failure.
- [ ] Implement handler and protocol documentation; perform state change under the same room lock as the validation.
- [ ] Run focused tests, format and clippy; require pass.
- [ ] Commit handler, tests and protocol update.

### Task 3: Reconnection and succession

**Interfaces:** `promote_next_host` prefers an active Administrator when current Owner leaves or the 10-second grace expires. On promotion clear Administrator role and broadcast current role state plus `host_changed`.

- [ ] Write failing tests: Owner returns within grace; grace expires with Administrator; voluntary exit; Administrator disconnected; two connections of same user; no eligible successor; old Owner returns after transfer.
- [ ] Run focused tests; confirm failures.
- [ ] Implement deterministic selection and state cleanup in `room/leave.rs` and join/reconnect path, preserving existing fallback and invitation/approval logic.
- [ ] Run focused server suite and protocol tests; require pass.
- [ ] Commit succession and tests.

### Task 4: Server authorization for shared controls

**Interfaces:** Central helper `room::can_control(room: &Room, client: &Client, action: RoomAction) -> bool` used by playback, queue and moderation; Owner-only operations retain direct Owner checks. Administrator cannot target Owner's account, including another connection.

- [ ] Write failing tests for allowed playback/queue/moderation, denied close/transfer/role changes, denied Owner targeting, revocation taking effect immediately and permissions for ordinary guests remaining unchanged.
- [ ] Run focused tests; confirm failures.
- [ ] Implement helper and replace affected host checks without broad behavior changes. If an action's scope differs between #171/#173, encode it explicitly in `RoomAction`.
- [ ] Run full Rust suite, format and clippy; require pass.
- [ ] Commit authorization and tests.

### Task 5: Client role and approved interface

**Interfaces:** Client role state exposes current Owner and Administrator. Participant `⋯` shows role action only for Owner, with confirmation; after success show `Administrador` badge. Owner badge text is `Owner`. Administrator sees allowed controls and moderation only for guests.

- [ ] Write failing JS tests for menu, confirmations, one-Administrator guard, badges, role changes, focus return, old-server fallback and authorization-aware controls.
- [ ] Run targeted JS tests; confirm failures.
- [ ] Implement WebSocket state, participant UI, CSS and translations in all existing locales. Use person-with-× icon for Quitar.
- [ ] Run JS tests/lint and inspect desktop/mobile captures against approved renders.
- [ ] Commit UI and tests.

### Task 6: End-to-end and final review

**Interfaces:** New `e2e/tests/room-administrator.spec.js` covers assignment, enforcement and succession in an isolated laboratory.

- [ ] Add E2E: Owner appoints Ana, Ana controls media and moderates Bruno, cannot close or target Owner; Owner reconnects within grace; after definitive departure Ana becomes Owner; old clients still join.
- [ ] Run focused E2E then full relevant E2E and Rust/JS/plugin suites on the integrated branch. Resolve only evidenced failures.
- [ ] Verify production containers/config are unchanged. Run `git diff --check`, format/lint and review final PR diff for unrelated dependency commits.
- [ ] Write PR description with explicit dependency order and captured tests. Request branch review before publication or production deployment.

## Plan review

Spec coverage: role model/compatibility (1), single appointment (2), recovery (3), powers (4), interface (5), integration/evidence (6). Five review-focus cases have owning tests. The source branch stays isolated from production.
