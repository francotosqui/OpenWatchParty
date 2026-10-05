---
title: Protocol
parent: Technical
nav_order: 2
---

# WebSocket Protocol Specification

## Overview

OpenWatchParty uses a JSON-over-WebSocket protocol for real-time communication between clients and the session server.

**Endpoint:** `ws(s)://<host>:3000/ws`

## Protocol Version

The WebSocket protocol has its own version, independent of the product release. The current version is `1`.

| Version | Status | Notes |
|---------|--------|-------|
| `1` | Current | Initial negotiated version. |

**Negotiation:** clients declare their version in the `protocol_version` field of the `auth` message. A missing field is treated as `1`, so clients that predate negotiation keep working. The server echoes `protocol_version` in `auth_success` only when the client declared one, which keeps the previous `auth_success` payload for older clients. The version is also reported by `GET /health` (`protocol_version`) and by the plugin's `/OpenWatchParty/Token` response.

**Mismatch policy:** the server only speaks version `1`. A declared version other than `1` — or a malformed `protocol_version` — is rejected with an `error` whose code is `PROTOCOL_VERSION_UNSUPPORTED`; the WebSocket is then closed with close code `1008`.

**Compatibility rules:**

- New message types are additive. Receivers must ignore messages whose `type` they do not know instead of failing the session.
- Existing payload fields are frozen: fields are never removed, renamed, or repurposed. New fields are optional, and receivers ignore fields they do not know.
- The version changes only for an incompatible change (a removed or retyped field, or changed semantics); additive changes keep the current version.

The minimum supported client protocol version is `1`.

## Message Format

All messages follow this structure:

```json
{
  "type": "message_type",
  "room": "room_id",
  "client": "client_id",
  "payload": { ... },
  "ts": 1678900000000,
  "server_ts": 1678900000100
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Message type |
| `room` | string | No | Room ID (if applicable) |
| `client` | string | No | Sender client ID |
| `payload` | object | No | Message-specific data |
| `ts` | number | Yes | Client timestamp (ms since epoch) |
| `server_ts` | number | No | Server timestamp (added by server) |

## Client → Server Messages

### `auth`

Authenticate with a JWT token (if authentication is enabled) and declare the client protocol version.

```json
{
  "type": "auth",
  "payload": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "protocol_version": 1
  },
  "ts": 1678900000000
}
```

| Payload Field | Type | Required | Description |
|---------------|------|----------|-------------|
| `token` | string | No | JWT issued by the `/OpenWatchParty/Token` endpoint |
| `protocol_version` | number | No | Client protocol version; defaults to `1` when omitted |

On a protocol version mismatch the server answers with `error` (`PROTOCOL_VERSION_UNSUPPORTED`) and closes the connection.

### `list_rooms`

Request the list of active rooms.

```json
{
  "type": "list_rooms",
  "ts": 1678900000000
}
```

**Response:** `room_list`

### `create_room`

Create a new watch party room.

```json
{
  "type": "create_room",
  "payload": {
    "name": "Movie Night",
    "start_pos": 0.0,
    "media_id": "abc123def456"
  },
  "ts": 1678900000000
}
```

| Payload Field | Type | Description |
|---------------|------|-------------|
| `name` | string | Room display name |
| `start_pos` | number | Initial position (seconds) |
| `media_id` | string | Jellyfin media ID (optional) |

**Response:** `room_state`

**Effects:**
- Client becomes host
- Host receives `participant_list` with its own name, after `room_state`
- Broadcast `room_list` to all clients

### `join_room`

Join an existing room.

```json
{
  "type": "join_room",
  "room": "uuid-room-id",
  "ts": 1678900000000
}
```

**Response:** `room_state`

**Effects:**
- Client added to `room.clients`
- Client removed from `room.ready_clients`
- Broadcast `participants_update` to other participants
- Broadcast `participant_list` to everyone in the room, including the new client (after its `room_state`)

### `leave_room`

Leave the current room.

```json
{
  "type": "leave_room",
  "room": "uuid-room-id",
  "ts": 1678900000000
}
```

**Effects:**
- If host leaves: room closes, broadcast `room_closed`
- Otherwise: broadcast `client_left`, then `participant_list`
- Broadcast `room_list` to all

### `ready`

Indicate client is ready to receive playback commands.

```json
{
  "type": "ready",
  "room": "uuid-room-id",
  "payload": {
    "media_id": "abc123def456"
  },
  "ts": 1678900000000
}
```

**Effects:**
- Client added to `room.ready_clients`
- If `pending_play` exists and `all_ready()`: triggers scheduled play

### `player_event`

Send a playback event (host only).

```json
{
  "type": "player_event",
  "room": "uuid-room-id",
  "payload": {
    "action": "play",
    "position": 120.5
  },
  "ts": 1678900000000
}
```

| Payload Field | Type | Description |
|---------------|------|-------------|
| `action` | string | `"play"`, `"pause"`, `"seek"`, or `"buffering"` |
| `position` | number | Current position (seconds) |

**Behavior by action:**

| Action | Server Behavior |
|--------|-----------------|
| `play` | If `all_ready()`: broadcast with `target_server_ts = now + 1000ms`. Otherwise: create `pending_play` |
| `pause` | Broadcast with `target_server_ts = now + 300ms` |
| `seek` | Broadcast with `target_server_ts = now + 300ms` |
| `buffering` | Broadcast with `target_server_ts = now + 300ms` (treat as paused) |

**Effects:**
- Updates `room.state`
- Updates `room.last_command_ts` (cooldown)
- Broadcasts to other participants

### `state_update`

Periodic playback state update (host only).

```json
{
  "type": "state_update",
  "room": "uuid-room-id",
  "payload": {
    "position": 125.3,
    "play_state": "playing"
  },
  "ts": 1678900000000
}
```

| Payload Field | Type | Description |
|---------------|------|-------------|
| `position` | number | Current position (seconds) |
| `play_state` | string | `"playing"` or `"paused"` |

**Server filtering:**
1. Ignored if `now - last_command_ts < 2000ms` (cooldown)
2. Ignored if `now - last_state_ts < 500ms` (rate limit)
3. Ignored if position moves back 0.5s-2s (HLS jitter)
4. Ignored if position advances < 0.5s (insignificant)
5. Always accepted if `play_state` changes

### `ping`

Latency measurement and clock synchronization.

```json
{
  "type": "ping",
  "payload": {
    "client_ts": 1678900000000
  },
  "ts": 1678900000000
}
```

**Response:** `pong`

### `chat_message`

Send a text message to the room.

```json
{
  "type": "chat_message",
  "room": "uuid-room-id",
  "payload": {
    "text": "Hello everyone!"
  },
  "ts": 1678900000000
}
```

| Payload Field | Type | Description |
|---------------|------|-------------|
| `text` | string | Message text (max 500 characters) |

**Effects:**
- Message broadcast to all clients in the room (including sender)
- Rate limited by existing 30 msg/sec limit

**Error responses:**
- `"Chat message cannot be empty"` - Empty or whitespace-only text
- `"Chat message too long (max 500 characters)"` - Text exceeds limit
- `"Room ID required for chat"` - Missing room ID

## Server → Client Messages

### `client_hello`

Sent immediately after WebSocket connection.

```json
{
  "type": "client_hello",
  "client": "uuid-client-id",
  "payload": {
    "client_id": "uuid-client-id"
  },
  "ts": 1678900000000,
  "server_ts": 1678900000000
}
```

### `auth_success`

Sent after a successful `auth` with a JWT.

```json
{
  "type": "auth_success",
  "client": "uuid-client-id",
  "payload": {
    "user_name": "Alice",
    "protocol_version": 1
  },
  "ts": 1678900000000,
  "server_ts": 1678900000000
}
```

`protocol_version` is present only when the client declared it in `auth`; the server echoes the negotiated version.

### `room_list`

List of active rooms.

```json
{
  "type": "room_list",
  "payload": [
    {
      "id": "uuid-room-id",
      "name": "Movie Night",
      "count": 3,
      "media_id": "abc123def456"
    }
  ],
  "ts": 1678900000000,
  "server_ts": 1678900000000
}
```

### `room_state`

Full room state. Sent after `create_room` or `join_room`.

```json
{
  "type": "room_state",
  "room": "uuid-room-id",
  "client": "uuid-client-id",
  "payload": {
    "name": "Movie Night",
    "host_id": "uuid-host-id",
    "participant_count": 3,
    "media_id": "abc123def456",
    "state": {
      "position": 120.5,
      "play_state": "playing"
    }
  },
  "ts": 1678900000000,
  "server_ts": 1678900000000
}
```

### `participants_update`

Participant count update.

```json
{
  "type": "participants_update",
  "room": "uuid-room-id",
  "payload": {
    "participant_count": 4
  },
  "ts": 1678900000000,
  "server_ts": 1678900000000
}
```

### `participant_list`

Display names of the room's participants, in join order. Sent to the host when the room is created, and to everyone in the room after a client joins or leaves.

```json
{
  "type": "participant_list",
  "room": "uuid-room-id",
  "payload": {
    "participants": [
      { "name": "Alice", "is_host": true },
      { "name": "Bob", "is_host": false }
    ]
  },
  "ts": 1678900000000,
  "server_ts": 1678900000000
}
```

| Payload Field | Type | Description |
|---------------|------|-------------|
| `participants[].name` | string | Display name of the participant |
| `participants[].is_host` | boolean | Whether the participant is the room host |

It is a separate message so that `room_state`, `participants_update` and `client_left` keep their payloads: clients validate those strictly. A client that does not know `participant_list` ignores it, and the web client keeps showing the participant count until it receives one.

### `player_event`

Playback command relayed from host.

```json
{
  "type": "player_event",
  "room": "uuid-room-id",
  "payload": {
    "action": "play",
    "position": 120.5,
    "target_server_ts": 1678900001000
  },
  "ts": 1678900000000,
  "server_ts": 1678900001000
}
```

| Payload Field | Type | Description |
|---------------|------|-------------|
| `action` | string | `"play"`, `"pause"`, `"seek"`, or `"buffering"` |
| `position` | number | Reference position (seconds) |
| `target_server_ts` | number | Target server timestamp for execution |

**Client processing:**
1. Enable `isSyncing` lock (2s)
2. Calculate adjusted position with elapsed time
3. Schedule action at `target_server_ts`

### `state_update`

Periodic state update relayed from host.

```json
{
  "type": "state_update",
  "room": "uuid-room-id",
  "payload": {
    "position": 125.3,
    "play_state": "playing"
  },
  "ts": 1678900000000,
  "server_ts": 1678900000000
}
```

### `room_closed`

Room was closed (host disconnected or room empty).

```json
{
  "type": "room_closed",
  "ts": 1678900000000
}
```

### `client_left`

A participant left the room.

```json
{
  "type": "client_left",
  "room": "uuid-room-id",
  "client": "uuid-left-client-id",
  "payload": {
    "participant_count": 2
  },
  "ts": 1678900000000,
  "server_ts": 1678900000000
}
```

| Payload Field | Type | Description |
|---------------|------|-------------|
| `participant_count` | number | Updated participant count after the client left |

### `pong`

Response to ping.

```json
{
  "type": "pong",
  "payload": {
    "client_ts": 1678900000000
  },
  "ts": 1678900000050,
  "server_ts": 1678900000050
}
```

**Client-side RTT calculation:**
```javascript
const rtt = Date.now() - payload.client_ts;
const serverOffset = server_ts + (rtt / 2) - Date.now();
```

### `chat_message`

Chat message broadcast from server.

```json
{
  "type": "chat_message",
  "room": "uuid-room-id",
  "client": "uuid-sender-id",
  "payload": {
    "username": "Alice",
    "text": "Hello everyone!"
  },
  "ts": 1678900000000,
  "server_ts": 1678900000050
}
```

| Payload Field | Type | Description |
|---------------|------|-------------|
| `username` | string | Sender's display name |
| `text` | string | Message text |

**Client processing:**
1. Add message to local chat history (max 100 messages)
2. If chat panel not visible, increment unread badge
3. Render message in chat UI

### `error`

Error response.

```json
{
  "type": "error",
  "payload": {
    "code": "ROOM_NOT_FOUND",
    "message": "Error description"
  },
  "ts": 1678900000000,
  "server_ts": 1678900000000
}
```

`payload.code` is a stable machine-readable identifier in `SCREAMING_SNAKE_CASE`.
`payload.message` remains present for display and compatibility with existing clients.

| Code | Meaning |
|------|---------|
| `AUTHENTICATION_REQUIRED` | Authentication is required or the token is missing |
| `AUTHENTICATION_FAILED` | Token validation failed |
| `AUTHENTICATION_EXPIRED` | The authenticated session expired; the WebSocket is then closed |
| `AUTHENTICATION_TIMEOUT` | Authentication was not completed in time; the WebSocket is then closed |
| `PROTOCOL_VERSION_UNSUPPORTED` | The declared `protocol_version` is unsupported or malformed; the WebSocket is then closed |
| `RATE_LIMITED` | The message rate limit was exceeded; the WebSocket is then closed |
| `MESSAGE_TOO_LARGE` | The WebSocket message exceeds the protocol size limit |
| `UNSUPPORTED_MESSAGE_FORMAT` | The client sent a non-text message, including a binary message |
| `INVALID_JSON` | The text message is not a valid protocol JSON envelope |
| `UNKNOWN_MESSAGE_TYPE` | The message `type` is unknown |
| `ROOM_ID_REQUIRED` | A room-scoped operation omitted `room` |
| `ROOM_NOT_FOUND` | The requested room does not exist |
| `ROOM_FULL` | The requested room reached its participant limit |
| `NOT_ROOM_MEMBER` | The client is not a member of the requested room |
| `HOST_PERMISSION_REQUIRED` | A non-host client attempted to control playback |
| `INVALID_PLAYBACK_PAYLOAD` | A playback payload is absent, malformed, or outside accepted bounds |
| `NOT_IN_ROOM` | `leave_room` was requested while the client had no room |
| `INVALID_READY` | A `ready` transition is missing required room context |
| `INVALID_CHAT_PAYLOAD` | The chat payload does not contain a string `text` field |
| `CHAT_MESSAGE_EMPTY` | Chat text is empty |
| `CHAT_MESSAGE_TOO_LONG` | Chat text exceeds the configured limit |

## Sequence Diagram: Complete Session

```
Client A                    Server                    Client B
    │                          │                          │
    ├── WebSocket connect ────►│                          │
    │◄─── client_hello ────────┤                          │
    │◄─── room_list ───────────┤                          │
    │                          │                          │
    ├── create_room ──────────►│                          │
    │◄─── room_state ──────────┤                          │
    │                          ├─── room_list (broadcast) │
    │                          │                          │
    │                          │◄── WebSocket connect ────┤
    │                          ├─── client_hello ────────►│
    │                          ├─── room_list ───────────►│
    │                          │                          │
    │                          │◄── join_room ────────────┤
    │◄─ participants_update ───┤─── room_state ──────────►│
    │◄─ participant_list ──────┼─── participant_list ────►│
    │                          │                          │
    │                          │◄── ready ────────────────┤
    │                          │                          │
    ├── player_event (play) ──►│                          │
    │                          │   all_ready() = true     │
    │◄─ player_event ──────────┼─── player_event ────────►│
    │   target_ts = T+1000     │   target_ts = T+1000     │
    │                          │                          │
    │   [T+1000ms]             │                [T+1000ms]│
    │   video.play()           │              video.play()│
    │                          │                          │
    ├── state_update ─────────►│                          │
    │                          ├─── state_update ────────►│
    │                          │                          │
    ├── ping ─────────────────►│                          │
    │◄─── pong ────────────────┤                          │
    │                          │                          │
    ├── leave_room ───────────►│                          │
    │                          ├─── room_closed ─────────►│
    │◄─── room_list ───────────┼─── room_list ───────────►│
    │                          │                          │
```
