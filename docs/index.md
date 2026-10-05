---
title: Home
layout: home
nav_order: 1
---

<p align="center">
  <img src="readme-logo.png" alt="OpenWatchParty — Real-time sync for Jellyfin" width="480">
</p>

# OpenWatchParty Documentation

OpenWatchParty is a Jellyfin plugin that enables synchronized media playback across multiple clients. Watch movies and shows together with friends, no matter where they are.

## Quick Start

### For Users

Deploy the session server and install the plugin.
Follow the [illustrated first watch-party tutorial](product/first-watch-party/) for installation, screenshots and a two-person walkthrough. The [Installation Guide](operations/installation/) covers manual alternatives.

### For Developers

Set up a development environment:

```bash
git clone https://github.com/mhbxyz/OpenWatchParty.git
cd OpenWatchParty
just setup   # Configure git hooks (required once)
just up      # Build and start Jellyfin + session server
just dev     # Start with log following
just watch   # Auto-restart on file changes
```

See [Development Setup](development/setup/) for the full workflow and [First Watch Party](product/first-watch-party/#host-create-a-room) for the illustrated host/guest steps.

---

## Documentation

| Getting Started | Operations | Technical |
|-----------------|------------|-----------|
| [First Watch Party](product/first-watch-party/) | [Installation](operations/installation/) | [Architecture](technical/architecture/) |
| [Overview](product/overview/) | [Guided Setup](operations/owpctl/) | [Protocol](technical/protocol/) |
| [Features](product/features/) | [Configuration](operations/configuration/) | [Server](technical/server/) |
| [User Guide](product/user-guide/) | [Deployment](operations/deployment/) | [Client](technical/client/) |
| [FAQ](product/faq/) | [Compatibility](operations/compatibility/) | [Plugin](technical/plugin/) |
| | [Security](operations/security/) | [Sync Algorithms](technical/sync/) |
| | [Troubleshooting](operations/troubleshooting/) | [REST API](technical/api/) |
| | [Monitoring](operations/monitoring/) | |

## Development

- [Development Setup](development/setup/) - Get started contributing
- [Contributing Guide](development/contributing/) - Code style and PR process
- [Testing](development/testing/) - Running tests
- [CI/CD](development/ci/) - Automated workflows
- [Release Process](development/release/) - How releases are made

## Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Jellyfin Web   │     │  Session Server │     │  Jellyfin Web   │
│    (Host)       │◄───►│     (Rust)      │◄───►│   (Clients)     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                        │                       │
        └────────────────────────┴───────────────────────┘
                         WebSocket (ws://)
```

**Components:**
- **Jellyfin Plugin (C#)** - Serves client JavaScript, provides configuration UI
- **Session Server (Rust)** - Manages rooms and relays sync messages via WebSocket
- **Web Client (JavaScript)** - Injected into Jellyfin UI, handles playback synchronization

## Glossary

Technical terms used throughout this documentation:

| Term | Full Name | Description |
|------|-----------|-------------|
| **HLS** | HTTP Live Streaming | Adaptive streaming protocol that breaks video into small segments. Used by Jellyfin for transcoded content. |
| **RTT** | Round-Trip Time | Time for a message to travel from client to server and back. Displayed in the room bar as latency. |
| **EMA** | Exponential Moving Average | Smoothing algorithm used for clock synchronization. Prevents sudden jumps in time offset. |
| **JWT** | JSON Web Token | Compact, URL-safe token format for authentication. Contains user identity claims signed with a secret key. |
| **CORS** | Cross-Origin Resource Sharing | Browser security mechanism controlling which websites can connect to the session server. |
| **WebSocket** | - | Full-duplex communication protocol over a single TCP connection. Used for real-time sync. |
| **Drift** | - | Difference between expected and actual playback position. Corrected by adjusting playback rate. |
| **Host** | - | The user who created the watch party room. Has exclusive control over playback. |
