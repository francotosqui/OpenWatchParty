# Changelog

## [0.7.0] - 2026-10-22

This release targets Jellyfin 12.0 and 12.1 with target ABI
`12.0.0.0`. The WebSocket protocol remains version 1. Rust builds retain the
1.88 minimum supported toolchain. Plugin automatic updates remain disabled by
default pending the project's official publication and upgrade-path checks.

### Added

- Host-controlled room media queues, with up to 20 items, optional episode
  autofill, synchronized advancement and cancellable up-next countdowns.
- Configurable Watch Party opacity and text size, with proportional controls
  and a reduced-transparency fallback.
- A Watch Party entry point in the player's header, next to Cast.
- Shared guest play/pause controls, while seeking remains host-controlled.
- Host transfer, a reconnect recovery window and participant playback status.
- Manual guest synchronization adjustment, first-run help and localized UI
  strings.
- Prometheus metrics, readiness checks, WebSocket ingress fuzzing and
  authenticated room-lifecycle browser tests.

### Changed

- Reduced unnecessary client work outside rooms, capped rendered chat at 100
  messages and reduced server room-list broadcasts.
- Kept small Jellyfin index-injection responses in memory.
- Improved lobby, home-card and enabled-control presentation.
- Limited ordinary guest catch-up playback speed to 1.15x.

### Fixed

- Preserve room membership across stream reloads and player-based joins.
- Recheck zombie activity under the removal lock before disconnecting a client.
- Prevent an authentication-secret sequence check from overflowing on a byte
  value of `0xff`.
- Preserve plugin settings not managed by owpctl and route invite requests
  correctly in reverse-proxy examples.

### Security

- Bound application pong responses to a validated timestamp instead of
  reflecting arbitrary payload, room or client fields. This removes the large
  queued-pong response path before and after authentication. Valid clock-sync
  timestamps remain unchanged. Tracked as GHSA-fjpr-3g28-27r9.
- Enforce the inviter bookkeeping cap after pruning expired entries, while
  preserving existing inviters' rate-limit windows.
- Serialize per-IP permit acquisition and cleanup under the same map mutex,
  reclaiming idle entries without weakening connection limits.
- Keep chat contents out of diagnostic logs.
- Update affected TLS dependencies in owpctl and refresh Alpine runtime
  packages during image builds.

Thanks to @francotosqui for the private security report, review and hardening
fixes.

Earlier releases and their assets remain listed in
[GitHub Releases](https://github.com/mhbxyz/OpenWatchParty/releases).
