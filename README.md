<p align="center">
  <img src="docs/readme-logo.png" alt="OpenWatchParty — Real-time sync for Jellyfin" width="640">
</p>

<p align="center">
  <strong>Watch movies together, no matter the distance.</strong>
</p>

<p align="center">
  <a href="https://github.com/mhbxyz/OpenWatchParty/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/mhbxyz/OpenWatchParty/ci.yml?branch=main&style=flat-square&label=CI" alt="CI"></a>
  <img src="https://img.shields.io/badge/OpenWatchParty-0.5.0-blue?style=flat-square" alt="OpenWatchParty 0.5.0">
  <img src="https://img.shields.io/badge/Jellyfin-12.1-00a4dc?style=flat-square&logo=jellyfin" alt="Jellyfin 12.1">
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT License">
</p>

---

OpenWatchParty enables synchronized media playback for [Jellyfin](https://jellyfin.org/). It consists of a **Jellyfin Plugin** (C#) that integrates the UI and a **Session Server** (Rust) that manages rooms and synchronization via WebSocket.

<p align="center">
  <img src="docs/assets/images/watch-party-panel.png" alt="A synchronized watch party in the Jellyfin player" width="720">
</p>

## Quick Start

### Users

Already running Jellyfin? Follow the [illustrated first watch-party tutorial](https://mhbxyz.github.io/OpenWatchParty/product/first-watch-party/) to install the plugin and session server, verify them, and invite a second user. The server needs authentication configured on **both** sides; starting its container alone is not a complete installation.

### Developers

```bash
git clone https://github.com/mhbxyz/OpenWatchParty.git
cd OpenWatchParty
just up
```

See the [Development Setup Guide](https://mhbxyz.github.io/OpenWatchParty/development/setup/) and then the [illustrated two-user walkthrough](https://mhbxyz.github.io/OpenWatchParty/product/first-watch-party/#host-create-a-room).

## Documentation

**[mhbxyz.github.io/OpenWatchParty](https://mhbxyz.github.io/OpenWatchParty/)**

## Contributing

- [Report bugs](https://github.com/mhbxyz/OpenWatchParty/issues)
- [Submit pull requests](https://github.com/mhbxyz/OpenWatchParty/pulls)
- [Contributing Guide](CONTRIBUTING.md)

## License

MIT
