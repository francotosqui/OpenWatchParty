# Persistent Room Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Owner explicitly save and close a room, then list, resume or discard durable private checkpoints through the approved panel.

**Architecture:** A bounded SQLite worker provides durable account-owned snapshots independently of live Room serialization. Negotiated WebSocket handlers coordinate storage operations with short runtime reservations; room state locks never cover disk I/O. The client adds a saved-session view in the lobby and room toolbar, preserving existing leave and close actions.

**Tech Stack:** Rust server with Tokio/Warp, rusqlite with bundled SQLite compatible with the repository Rust floor, vanilla JavaScript client, Node tests and real Playwright/Jellyfin E2E.

**Spec:** `docs/superpowers/specs/2026-11-03-persistent-rooms-design.md`

## Global Constraints

- Explicit Owner-only Save and close. No automatic save on departure, restart or crash.
- Private checkpoints keyed to the verified, nonempty Jellyfin account. Disabled in insecure mode or when no data directory is configured.
- Restore paused with queue, position, room/access permissions, blocked/admitted users and Administrator account. No live sockets, readiness, timers, transient suggestions or chat history.
- Fresh live room/invite IDs on resume; stable saved-session ID. One live instance per checkpoint. Preserve the old checkpoint until explicit update/discard.
- Defaults: 20 checkpoints per account and 1000 total. No automatic expiry unless configured; reject capacity overflow without eviction.
- Disk failure never reports success or closes the original room. Mutations, succession and cleanup must respect the save reservation.
- Approved render: `owp-pr/render-178/saved-sessions.html`, `178-saved.png`, `178-discard.png` in the parent deployment workspace.
- English PR referencing mhbxyz/OpenWatchParty#178; document integration base 3e73104d and dependencies. Personal deployment requires backup and a persistent volume.

## Review Focus

- Owner disconnects while a slow save is committing: no premature succession/deletion and no duplicate checkpoint; Task 3.
- Two tabs of the same account resume one checkpoint simultaneously: exactly one live room; Task 4.
- A stale list or confirmation arrives after logout/account change: no leaked metadata or mutation under the wrong session; Tasks 2 and 5.
- Process crashes after a checkpoint commits but before client acknowledgement: checkpoint remains recoverable after restart; Tasks 1 and 6.
- A room timer or queued command fires during save: snapshot position and queue stay consistent, and a failed write unfreezes normal behavior; Task 3.

## File Map

New server modules: `src/server/src/persistence/{mod,model,sqlite}.rs` for the handle/configuration, bounded snapshot DTOs and SQLite worker. New handlers: `src/server/src/ws/handlers/saved_sessions.rs`. Modify `types.rs`, `main.rs`, `room/{mod,leave,close}.rs`, room mutation handlers, pending-play/tasks, auth/dispatch/metrics, and protocol/operations docs. Client: new `ui/saved-sessions.js` with panel rendering; existing state, send/validation/connection, room handlers, room/lobby controls, styles, i18n, module loader/build list. Tests live beside Rust modules, in `src/clients/jellyfin-web/tests/saved-sessions.test.js`, and `e2e/tests/persistent-rooms.spec.js`.

### Task 1: Durable bounded storage

**Files:** create persistence modules; modify server Cargo.toml/Cargo.lock and main.rs; document environment settings in operations/configuration.md.

**Interfaces:**
- `SavedRoom` is a versioned serde DTO: `schema_version`, `id`, `owner_user_id`, `name`, `saved_at_ms`, `expires_at_ms`, `media_id`, `media_title`, `position`, queue items including series, `last_added`, `permissions`, `access`, `blocked_users`, `admitted_users`, `administrator_user_id`.
- `StorageConfig::from_env() -> Result<Option<StorageConfig>, StorageError>` reads `PERSISTENT_ROOMS_DIR`, `MAX_SAVED_ROOMS_PER_USER` (20), `MAX_SAVED_ROOMS` (1000), `SAVED_ROOMS_RETENTION_DAYS` (0 = no expiry). Reject zero capacities, invalid directories and overflow.
- Cloneable `SavedRoomStore::open(config) -> Result<SavedRoomStore, StorageError>` starts one bounded worker, owns the SQLite connection and migrations. Async `list(owner, now_ms)`, `get(owner, id, now_ms)`, `put(snapshot, now_ms)`, `delete(owner, id)` return typed Results through oneshots. Transactional ownership predicates on every operation; all disk work on the worker thread.
- `StorageError` distinguishes capacity, not-found, unavailable, corrupt-data and incompatible-schema without exposing SQL or private data on the wire.

- [ ] Write tests `checkpoint_survives_reopen`, `foreign_owner_cannot_read_replace_or_delete`, `capacity_rejects_without_eviction`, `expired_rows_are_not_resumed`, `newer_schema_is_not_overwritten`, `corrupt_snapshot_is_rejected`, `failed_replace_preserves_previous_checkpoint`. Assert 20/1000 defaults and immutable owner on replacement.
- [ ] Run focused persistence tests; confirm RED for missing modules/interfaces.
- [ ] Implement explicit DTO validation (queue bound 20, finite positions, UUID checkpoint IDs, bounded strings and account sets) and transactional SQLite migration using user_version. Parameterize all SQL. Create directory/database privately. An invalid configured store fails startup clearly; absent configuration leaves the feature disabled.
- [ ] Run focused tests including worker shutdown/channel failure and interrupted transaction/reopen; require GREEN. Lock a Rust-compatible dependency version and run cargo check with the repository floor.
- [ ] Commit storage and tests independently.

### Task 2: Negotiated private listing and discard

**Files:** types.rs, main.rs, ws/handlers/auth.rs, ws/handlers/saved_sessions.rs, ws/handlers/mod.rs, ws/dispatch.rs, metrics.rs, test_helpers.rs, technical/protocol.md.

**Interfaces:**
- `ServerState.saved_room_store: Option<SavedRoomStore>`; Default remains disabled for legacy tests. Initialize only for configured storage and secure JWT authentication.
- Client feature `persistent_rooms`; store negotiated support on Client.
- Client messages: `list_saved_sessions { request_id }`, `save_room_session { request_id }`, `resume_saved_session { request_id, id }`, `discard_saved_session { request_id, id }`. Request IDs are nonempty <=64 characters; opaque IDs are UUIDs. Strict payloads.
- Server `saved_sessions { request_id, sessions }`; each entry exposes only id/name/content/position/queue count/saved time/optional expiry/active flag. `saved_session_result { request_id, action, id, room_id? }` confirms a completed mutation. Failures include request_id in a dedicated `saved_session_error { request_id, code, message }` response, preserving legacy Error payloads.
- List/discard handlers copy authenticated account/version under lock, await worker outside the lock, then revalidate connection account/authentication_version before sending replies. Operations already authorized may finish after transport loss, but never reply to a replacement identity.

- [ ] Write handler tests for unauthenticated/insecure/legacy denial, strict payloads, cross-account IDs, account change during I/O and discard while live/busy. Verify no saved metadata reaches another account or legacy client.
- [ ] Run focused tests and confirm RED.
- [ ] Implement feature negotiation only when available; implement private list/discard and typed error mapping. Use current live Room.saved_session_id and reservation fields (introduced as empty defaults here) to expose active state and reject active discard. Register every wire/error label in metrics and serialization tests.
- [ ] Document protocol and run auth/metrics/handler tests; require GREEN.
- [ ] Commit protocol and listing/discard.

### Task 3: Atomic Save and close with room reservations

**Files:** saved_sessions.rs; room/mod.rs, leave.rs, close.rs; types.rs; playback, queue, queue_suggestions, administrator, moderation, access, join/create handlers; ws/pending_play.rs; tasks.rs.

**Interfaces:**
- `Room.saved_session_id: Option<String>` identifies a checkpoint lineage; `Room.saving: Option<SaveReservation>` carries an operation generation, captured position/time and playback state. ServerState also tracks checkpoint operations by ID so a concurrent discard/resume cannot race a pending write.
- `room::is_saving(room) -> bool` is checked under the same lock as every affected mutation. Saving responses use ROOM_SAVE_IN_PROGRESS; reads remain available. Timer callbacks and cleanup defer destructive room actions until reservation settles.
- `capture_saved_room(room, owner, id, now_ms) -> Result<SavedRoom, SaveError>` computes the effective position at capture time and omits transient state. `finish_saved_room(state, room_id, generation, result)` applies a matching result only, closes after durable success, or restores normal room behavior after failure.

- [ ] Write tests `only_owner_can_save`, `admin_cannot_save_until_inheriting`, `failed_write_keeps_room_members_and_queue`, `duplicate_save_has_one_checkpoint`, `disconnect_during_save_defers_succession`, `timer_and_queue_command_cannot_cross_save_capture`, `stale_save_result_cannot_close_replacement_room`.
- [ ] Run the tests with a controllable slow/failing storage seam; confirm RED.
- [ ] Implement authorization/capture/reservation under the shared lock, await put outside it, and finalize by generation. Freeze effective playback for clients with normal authoritative pause state; preserve the pre-save state for failure recovery. Cancel/defer pending play/countdown generations without letting an old timer advance the room.
- [ ] Add under-lock guards to all mutating handlers and room cleanup/transfer paths. A disconnected Owner is processed through existing recovery rules after failure; successful saves close every member with a distinct localized reason. Do not rely only on a pre-dispatch guard, which would race later lock acquisition.
- [ ] Run save/disconnect/concurrency/playback/queue suites, and verify no disk await occurs under a room state lock. Require GREEN.
- [ ] Commit save-and-close lifecycle.

### Task 4: Resume a private checkpoint as a paused room

**Files:** saved_sessions.rs, create.rs (extract reusable room constructor if necessary), room queue/participants helpers, messaging.rs, protocol docs.

**Interfaces:**
- `restore_saved_room(snapshot, client_id, new_room_id, now_ms) -> Result<Room, SaveError>` restores durable fields into a fresh paused Room, sets saved_session_id and clears all transient membership/timers/chat/suggestions.
- Resume uses a checkpoint operation reservation before awaiting get; after loading it rechecks account/version, current client membership, live-room capacity and checkpoint activity under lock. Reject ALREADY_IN_ROOM rather than silently leaving or closing. Failed restore clears reservation and keeps the checkpoint.

- [ ] Write tests `resume_is_paused_with_full_queue_and_access`, `same_account_tabs_create_one_live_instance`, `resume_rejects_existing_membership`, `failed_resume_keeps_checkpoint`, `blocked_and_admitted_accounts_survive`, `old_invite_cannot_join_new_live_id`, `admin_role_recovers_for_compatible_account_only`.
- [ ] Run focused tests; confirm RED.
- [ ] Reuse existing room_state/queue/permissions/access/role notifications in their expected order; new logical checkpoint ID never becomes an admission bypass. A later Save and close updates the same checkpoint atomically. Closing without saving leaves its prior checkpoint available.
- [ ] Run full Rust suite plus protocol tests; require GREEN.
- [ ] Commit resume behavior and tests.

### Task 5: Approved saved-session selector and confirmations

**Files:** state.js, ui/saved-sessions.js (new), ui/room.js, ui/lobby.js, ui/styles.js, ui/panel-elements.js, ui/render.js, ws/send.js, ws/handlers/room.js, ws/validation.js, ws/connection.js, utils/i18n.js, plugin module manifests and infra/just/common.just; saved-sessions.test.js.

**Interfaces:**
- State owns savedSessions, savedSessionsReceived, savedSessionsError, savedSessionPending and request generation/session identity. Reset private state on logout/account change/transport replacement; ignore stale responses. No durable browser snapshots.
- Actions `listSavedSessions()`, `saveRoomSession()`, `resumeSavedSession(id)`, `discardSavedSession(id)` generate request IDs and match acknowledgements. Refresh list after successful mutations/authentication. Distinguish busy, not-found, capacity and unavailable errors.
- UI `updateSavedSessions()` and `createSavedSessionsButton()` serve both lobby and live toolbar. Place bookmark immediately before panel X with accessible label/count; X remains Close panel. Cards include per-session X, Resume or In progress, and optional expiry date. Current-session Save and close appears only to Owner.

- [ ] Write JS tests for supported/unsupported servers, lobby/room placement, private reset/stale replies, Owner/Admin visibility, saved-session X confirmation, pending/error retry, focus/Escape, empty state and active checkpoint protection.
- [ ] Run tests and observe RED.
- [ ] Implement panel against approved render, confirmation text and all current locale translations. Query Jellyfin availability with the current user's API before issuing Resume; missing media leaves the checkpoint intact and shows an error. If already in a room, guide through the existing leave confirmation and resume only on acknowledged departure; cancellation changes nothing.
- [ ] Update module loader/build manifests and associated fixture expectations. Run npm test, lint and syntax checks; require GREEN. Capture desktop/phone states and inspect for overflow, centered icons and focus visibility.
- [ ] Commit client and tests.

### Task 6: Real restart E2E and final integration verification

**Files:** e2e/tests/persistent-rooms.spec.js, e2e/README.md; isolated dev deployment configuration outside production; operations/deployment.md and configuration.md.

**Interfaces:** An opt-in `OWP_E2E_PERSISTENCE_RESTART` runner hook coordinates restart of only the isolated lab session container using its named persistent volume. Browser test code must not restart production or accept arbitrary shell text from a page.

- [ ] Add E2E with two authenticated accounts: create queue, seek/pause, save/close, restart lab session server, reconnect/list, resume paused at checkpoint, rejoin guest and verify queue/access, save replacement, discard/cancel/confirm. A foreign account must not see the checkpoint. Add missing-media and write-failure coverage through the test storage seam rather than modifying production.
- [ ] Run focused E2E against real isolated Jellyfin and server, preserving the data directory across restart. Verify checkpoint recovery after an unacknowledged committed save with a deterministic integration test.
- [ ] Run full relevant Rust/JS/plugin suites, Clippy with warnings denied, formatting, git diff --check, and a final requirements review. Resolve evidenced failures before publication; record exact commands, counts and source commit.
- [ ] Commit E2E and documentation. Update the ledger with evidence and any limitations; request final branch review as required by executing-plans.

### Task 7: English review PR and personal deployment

**Files:** English PR description, deployment staging/backup script in parent owp-pr directory, production compose storage mount only after verification.

- [ ] Push feature branch and create a review PR linked to mhbxyz/OpenWatchParty#178. Use an explicit integration base if upstream dependencies remain unmerged; never imply a fork review PR is an upstream main PR. Link the implementation in the original issue only within the user's authorized publication scope.
- [ ] Build the Release plugin/server from the exact verified commit. Prepare backup of current plugin, compose/config/secrets and persistent database if present; run authenticated Release smoke test and volume permissions checks.
- [ ] Check real playback/room activity. Install with brief restart only when idle or when explicitly authorized to interrupt active playback. Verify local/public served assets, protocol negotiation, health, database durability and preserved settings; rollback automatically on failed installation verification while preserving the new database.
- [ ] Report the actual PR URL, deployed commit/version and user-visible reload requirement. Do not mark deployed until the checks pass.

## Plan self-review

The approved UI maps to Task 5; durable ownership/capacity/migrations to Tasks 1-2; save consistency and disconnect/timer races to Task 3; resume and lineage to Task 4; restart durability and visual/integration checks to Task 6; English publication and real deployment to Task 7. Every Review Focus item has an owning test. The storage seam must be available to deterministic lifecycle tests before save handlers are implemented.
