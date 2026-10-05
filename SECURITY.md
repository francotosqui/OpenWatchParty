# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| 0.4.x (Jellyfin 12) | Yes |
| 0.3.4 (Jellyfin 10.11) | Yes |
| 0.3.3 and older | No |

## Reporting a Vulnerability

Do not open a public issue for a suspected vulnerability.

Use [GitHub Private Vulnerability Reporting](https://github.com/mhbxyz/OpenWatchParty/security/advisories/new). Include affected versions, reproduction steps, impact, and any proposed mitigation. Avoid including real credentials, tokens, media, or personal data.

You should receive an acknowledgement within 3 business days and an initial assessment within 7 business days. Confirmed issues are coordinated privately until a fix and advisory are ready. Disclosure timing depends on severity and deployment impact.

## Scope

Reports may cover the Rust session server, Jellyfin plugin, browser client, release artifacts, container images, CI/CD workflows, and dependency supply chain.

## Technical Documentation

The threat model (assets, actors, trust boundaries, STRIDE analysis) and the inventory of abuse limits (message and frame size, rate-limit windows, command cooldown, connection caps, authentication timeout, token rate limiting, name and chat length limits, proxy trust) are documented in [`docs/operations/security.md`](docs/operations/security.md).
