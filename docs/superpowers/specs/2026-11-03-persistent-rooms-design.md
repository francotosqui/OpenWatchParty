# Persistent room sessions (#178)

Status: functional and architectural specification for review; product code has not started.

## Approved intent and interface

The Owner explicitly chooses Save and close; ordinary departures do not automatically save a room. Keep the approved render in `owp-pr/render-178/saved-sessions.html` and `178-saved.png` as the visual reference. Add a bookmark button immediately before the panel's X. It opens Saved sessions, shows a count, and remains available when the viewer is outside a room. The X still only closes the panel.

Each saved session shows its room name, current content, saved playback position, timestamp and queue count, with Resume and an X to discard. Discard opens a confirmation naming the session. Discard removes the saved checkpoint, never Jellyfin media. The footer under Current session has Save and close this room, visible only to the live Owner. Its confirmation explains that the room ends for everyone.

## Ownership and resume behavior

Saved sessions belong to the authenticated Jellyfin account that is Owner when saved, including an Administrator who previously inherited ownership. Only that account can list, resume, update or discard them. Administrators cannot save/close someone else's room. Other users never receive saved-session metadata. Identity must be nonempty and verified; this feature is unavailable in insecure unauthenticated mode.

Resume restores the name, content, queue order, current item, last-added queue cursor, seek position, guest permissions, room access settings, blocked/admitted accounts and Administrator account assignment. Restore Administrator powers only when that account reconnects through a compatible authenticated client. Do not persist socket IDs, connection status, readiness, playback timers, votes, transient queue suggestions or chat history. Previously connected people must join again; resuming does not connect or start playback for them remotely.

Resume always opens paused. The saved session has a stable logical ID; each resumed live room gets a fresh live ID and fresh invite links. This prevents old invite links from bypassing the new session's admission flow. Only one live room may originate from a saved session at once. The saved checkpoint remains until explicitly discarded or replaced by Save and close; ordinary activity does not silently overwrite it. A live checkpoint shows In progress instead of another Resume action.

If the user is already in a room, Resume first asks them to leave it. Do not silently close, save or transfer their current room. Provide the existing leave flow, then resume only after membership departure is acknowledged. If the content is unavailable in Jellyfin, show an actionable error and preserve the checkpoint.

## Storage choice and limits

Use a local SQLite database in a configurable persistent data directory. A single serialized storage service owns database writes; run blocking database work outside Tokio's async request workers. SQLite transactions make save replacement, ownership checks and deletion atomic. This is preferable to a shared JSON file, which would require custom locking and recovery for concurrent updates; a separate database service would add deployment complexity unnecessary for this single-server feature.

The feature is opt-in through a persistent data-directory setting. Do not advertise the protocol feature when storage is disabled or cannot be opened. For the personal deployment, mount a dedicated Docker volume/directory and include it in backup and rollback instructions. Use a schema version and transactional migrations. A database from a newer unsupported schema must produce a clear startup error, never be silently replaced.

Default limits: 20 checkpoints per account, 1000 server-wide, and existing queue bounds. At a limit, keep all existing saves and ask the Owner to discard one. Default retention is until explicit discard, bounded by these capacities; support an optional operator-configured retention period. When expiry is configured, show its date in the saved entry and confirmation. Do not silently evict the oldest saved session to make space.

Store only the fields required above, with versioned bounded DTOs independent of the live Room serialization. No passwords, tokens or signing keys. Validate imported database rows before materializing a room. Use parameterized queries and account ownership predicates for every operation.

## Save consistency and failures

Authorize and capture the room under its state lock, including position advanced to the capture time when playing. Mark it as saving so playback, queue, moderation, role changes and succession cannot race the checkpoint; preserve whether it was playing. Release the shared room lock before awaiting disk I/O. Commit the snapshot transaction before closing the live room or reporting success. After commit, close the captured room and announce the saved outcome to its members.

A failed write leaves the original room and queue intact, clears saving state and allows retry; do not show Saved or close clients. A connection loss during saving cannot transfer or delete that room until the operation settles. On success close it normally; on failure apply normal owner reconnection/succession rules. Duplicate requests must not create multiple checkpoints. Capture identifiers/generations prevent a late result from affecting a replacement room.

Resume rechecks ownership, capacity and active-instance status under coordinated storage/runtime state before creating a paused room. A failed resume does not destroy the checkpoint or leave partial client membership. Deleting a checkpoint while it is saving/resuming must return a conflict rather than race the operation. A checkpoint associated with a running room cannot be discarded until the room is closed; the UI explains this.

## Protocol and client integration

Negotiate `persistent_rooms`; legacy clients see existing room and participant payloads unchanged. Use dedicated request/response messages for list, save-and-close, resume and discard. Requests carry an opaque request ID so errors and stale replies update the right UI operation. Validate bounded payloads, reject unknown fields and account/room mismatches, and register all new wire names and errors in metrics.

The client stores no authoritative snapshots in browser localStorage. It refreshes its own list after authentication, save, resume and discard; clear it on logout/account changes and ignore stale responses from previous connections. Render titles as text. Disable buttons while their request is pending; restore them on errors. Preserve focus on cancel/confirm, support Escape, provide accessible icon names and translate UI text in every existing locale.

The saved-session selector works in the lobby and active room panel. When there are no checkpoints, show an empty-state explanation; when storage is disabled, hide the unsupported control. Saving and closing is a distinct Owner action and does not change existing Leave or Close for everyone semantics.

## Verification and delivery

Storage tests: round trip after process restart; atomic replacement; bounded capacity; corrupt/newer schema; failed writes; expiry configuration; and cross-account list/resume/delete rejection. Room/protocol tests: Owner-only save, Administrator restrictions, inherited Owner identity, disk failure without closing, duplicate requests, owner disconnect during save, paused restore, one active instance and unchanged legacy payloads. Client tests cover selector placement, empty/error/loading states, confirmations, focus and account/reconnect state.

Run a real isolated browser scenario with Owner and guest: save and close, restart the session server with the same persistent volume, list the saved session, resume paused at the saved position with the queue, rejoin the guest, then discard with confirmation. Check desktop and narrow-screen captures against the approved render.

Create an English feature PR referencing mhbxyz/OpenWatchParty#178. The personal-server base is 3e73104d; state the existing integration dependencies explicitly and keep this feature's diff separate. Deployment follows successful tests with a backup, storage volume, configuration checks and an activity check before any restart. Rollback preserves the new database even if the previous server cannot read it.

## Excluded scope

No automatic save on departure or crash, scheduled sessions, democracy mode, shared browser history, automatic reconnection of other participants, multiple-server coordination, or transfer of saved sessions between accounts.
