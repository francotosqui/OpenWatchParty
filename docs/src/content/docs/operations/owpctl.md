---
title: "Guided Setup with owpctl"
---

<span id="guided-setup-with-owpctl" class="legacy-anchor"></span>

`owpctl` installs, configures, diagnoses, upgrades and removes OpenWatchParty. It manages its own hardened Compose project and adopts your existing Jellyfin without rewriting its deployment files.

## Download

| Platform | Asset |
|----------|-------|
| Linux x86_64 | `owpctl-linux-x86_64` |
| Linux arm64 | `owpctl-linux-aarch64` |
| macOS (Apple silicon) | `owpctl-macos-aarch64` |
| macOS (Intel) | `owpctl-macos-x86_64` |
| Windows x86_64 | `owpctl-windows-x86_64.exe` |

```bash
# Linux x86_64 example
curl -fLO https://github.com/mhbxyz/OpenWatchParty/releases/latest/download/owpctl-linux-x86_64
curl -fLO https://github.com/mhbxyz/OpenWatchParty/releases/latest/download/owpctl-linux-x86_64.sha256
sha256sum -c owpctl-linux-x86_64.sha256
chmod +x owpctl-linux-x86_64
sudo install -m 0755 owpctl-linux-x86_64 /usr/local/bin/owpctl
```

On macOS, verify with `shasum -a 256 -c`. Release assets also contain Sigstore and provenance bundles for independent verification.

## Graphical Setup

```bash
owpctl setup --web
```

This uses user scope and requires Docker access for that user. For system
scope, use `sudo owpctl --scope system setup --web` and open the one-time URL
printed in the terminal if it does not launch a browser. The
[illustrated walkthrough](/product/first-watch-party/#path-b-existing-jellyfin)
shows where to create a temporary Jellyfin API key, what to enter in the
assistant and how to verify the result.

The command opens a one-time URL bound to `127.0.0.1`. **Preview plan** parses
the Jellyfin URL and lists the planned operations without installing anything;
it does not test connectivity or validate the administrator token. A token is
not required for the preview. **Install** validates Docker and Jellyfin,
installs or upgrades the plugin, configures authentication, deploys the signed
session-server image and verifies health before stopping the assistant.

Open the printed URL once and keep the page open. Reloading it or opening it
again returns **Invalid or consumed setup token**. If this happens before
installation, stop the setup command and rerun it for a fresh session.
The web assistant stops after installation or 30 minutes. It does not write
the supplied administrator API token to its configuration files. Close the
page and revoke the temporary API key in Jellyfin after setup and diagnostics.

`install`, `upgrade` and `configure` write only the plugin settings owpctl manages: the JWT secret, audience and issuer, the token and invite lifetimes, and the session server URL, and it turns off unauthenticated access and the auto-detected session server. Every other plugin setting, such as hiding Jellyfin's SyncPlay button, keeps the value it had before the update. A setting the new plugin version no longer has, or now stores with a different type, takes that version's default.

## Remote Browser Access

When `owpctl setup --web` or `owpctl ui` runs over SSH, its loopback URL belongs
to the remote machine, not your computer. Keep that process running and create
an SSH local forward in another terminal on your computer. For example, if
the printed URL uses port `43123`:

```bash
ssh -N -L 127.0.0.1:43123:127.0.0.1:43123 user@jellyfin-host
```

Replace the host and both port numbers with your server and the printed port.
Use the same local and remote port so the assistant's origin check still
matches. Open the original one-time URL in your local browser, then keep that
page and the SSH forward open until setup finishes. Do not publish the setup
port or share the URL/token. Alternatively, use headless setup below.

## Headless Setup

Create the configuration:

```bash
sudo owpctl --scope system setup \
  --non-interactive \
  --jellyfin-url https://jellyfin.example.com
```

Store a temporary Jellyfin admin API token in a protected file, review the plan, then install:

```bash
sudo install -m 0600 /dev/null /run/owp-jellyfin-token
sudo sh -c 'read -r token; printf %s "$token" > /run/owp-jellyfin-token'
sudo owpctl --scope system install --dry-run --api-token-file /run/owp-jellyfin-token
sudo owpctl --scope system install --yes --api-token-file /run/owp-jellyfin-token
sudo rm -f /run/owp-jellyfin-token
```

## Diagnostics

Every `owpctl` command prints a human-readable summary by default. Passing `--json` switches the output to machine-readable JSON for scripting and automation.

```bash
owpctl status
owpctl doctor --api-token-file /run/owp-jellyfin-token
owpctl doctor --json --api-token-file /run/owp-jellyfin-token
owpctl doctor --bundle /tmp/owp-support.json --api-token-file /run/owp-jellyfin-token
```

`doctor` runs these checks in order:

- `docker`: verifies that the Docker daemon is reachable; failure means the managed services cannot be inspected or started.
- `compose`: verifies that Docker Compose is installed; failure means the managed stack cannot be operated.
- `jellyfin`: reads Jellyfin's public system information; failure means the configured Jellyfin URL is unreachable or invalid.
- `session_server`: validates the session server `/health` response, version, protocol and authentication mode; failure means the server is unreachable, unhealthy or returned an unexpected response.
- `session_ready`: checks `/ready`; failure means the server is shutting down, not ready or the reverse proxy does not expose the endpoint.
- `plugin`: reads the installed plugin metadata with the admin token; failure means the plugin is absent or the token lacks access.
- `versions`: compares Jellyfin, plugin, session-server and protocol versions with the compatibility matrix; failure identifies the component that must be upgraded or changed.
- `authentication`: compares token issuance with the session server's authentication mode; failure means their JWT modes or keys are configured inconsistently.
- `mixed_content`: verifies that an HTTPS Jellyfin page uses `wss://`; failure means browsers will block the WebSocket connection.
- `websocket`: performs a real upgrade, origin check, JWT authentication and ping/pong; failure distinguishes proxy, origin and authentication problems.
- `clock`: measures WebSocket round-trip latency and server clock offset; a warning indicates high latency or a clock that should be synchronized with NTP.
- `installation_phase`: warns when a saved installation did not reach its ready phase and should be resumed.

It never prints the token, JWT or secret. `--bundle` writes a redacted support file containing the report, desired configuration, installation state and, when an admin token is supplied, the plugin's own diagnostics report. The installation secret fingerprint is removed, and a plugin-report collection failure is recorded as a warning instead of preventing the bundle from being written.

## Dashboard

`owpctl ui` opens a local, read-only dashboard that presents the `doctor`
checks as tiles, with failures first. Use **Run again** to refresh the checks or
**Download support report** to download the same file produced by `doctor --bundle`.
The dashboard only reads configuration, state and service status.

The printed URL contains a one-time token. After opening it, reloading works in
the same browser session. Pass `--api-token-file <path>` to include the deep
plugin checks and plugin diagnostics in support downloads, or `--no-open` to
print the URL without launching a browser. Press Ctrl+C in the terminal to stop
the dashboard. For remote use, forward the printed loopback port over SSH using
the same local and remote port as described above.

## Active rooms

With a current plugin and session server, a Jellyfin administrator can list or
close active rooms using the same administrative WebSocket connection as the
plugin page:

```bash
owpctl rooms list --api-token-file /run/owp-jellyfin-token
owpctl --json rooms list --api-token-file /run/owp-jellyfin-token
owpctl rooms close <room-id> --api-token-file /run/owp-jellyfin-token
```

The list shows each room's ID and name, Owner, participant names/count,
playing/paused state, media ID and time open. JSON includes the server timestamp
and the complete snapshot. An empty list is a successful result.

By default the commands use the Jellyfin URL and public origin saved by
`owpctl setup`. For an existing deployment that is not managed by owpctl, pass
`--jellyfin-url https://jellyfin.example` to either subcommand. Jellyfin base
paths are supported; use the public URL when the reverse proxy's allowed origin
requires it. The session server URL is returned by the plugin; when the plugin
uses same-host detection, the CLI connects like the web page does, to the
Jellyfin host on port 3000 (`ws://`, or `wss://` for an HTTPS Jellyfin URL).

The protected token file must contain a Jellyfin administrator credential:
either a signed-in administrator's **user access token** or a server **API key**
(Dashboard → API Keys). With an API key the administrator connection has no user
identity, so the session server logs the close with an all-zero user ID; use an
administrator's user token when you want closes attributed to a person. A
regular user's token is refused. The CLI requests a short-lived administrator token
from `OpenWatchParty/AdminToken`; it never needs the session server's signing
secret and does not print either credential. An older plugin/server, a
non-administrator account or insecure server authentication produces an error.

Closing displays the room name, ID and participant count and asks for
confirmation, defaulting to **No**. After confirmation it obtains a fresh token,
reconnects and checks that the room still exists; taking time to decide does not
leave an idle administrative connection open. For scripts, use explicit confirmation:

```bash
owpctl --json rooms close <room-id> --yes --api-token-file /run/owp-jellyfin-token
```

`--yes` is required with redirected input or `--json`; without it no close is
sent. A successful command waits until the server reports that the room is gone
and returns `{ "closed": true, "room_id": "..." }` in JSON mode. Participants
receive the same administrator-closed notice as with the plugin page. A room
being saved stays open and returns an error; retry after the save completes.
A missing room is an error, and closing never deletes a saved session.
These commands do not restart or reconfigure Jellyfin or the session server.

## Maintenance

```bash
owpctl upgrade --dry-run --api-token-file /run/owp-jellyfin-token
owpctl upgrade --yes --api-token-file /run/owp-jellyfin-token
owpctl backup
owpctl logs                  # follow the session server logs
owpctl logs --tail 200 --no-follow
owpctl configure --set session.log-level=debug --api-token-file /run/owp-jellyfin-token
owpctl configure --rotate-jwt-secret --yes --api-token-file /run/owp-jellyfin-token
owpctl uninstall --yes --keep-config --api-token-file /run/owp-jellyfin-token
```

`install`, `upgrade` and `configure` retain plugin settings that owpctl does not
manage. Upgrade compatibility is conservative: fractions cannot replace an
integer setting, and changed arrays or objects retain the installed plugin's
value because its JSON does not expose the .NET schema. An invalid configuration
root aborts without posting a replacement. Configuration debug output redacts
all values, including unknown future secrets.

## Asymmetric Pairing

`owpctl setup` defaults to hybrid mode, which accepts shared-secret HS256 tokens and trusted RS256 tokens. Pairing registers the plugin public RSA key in the session-server trust store, activates RS256 issuance, then restarts the managed server in asymmetric mode without injecting the shared secret.

```bash
sudo owpctl --scope system pair \
  --jellyfin-url https://jellyfin.example.com \
  --api-token-file /run/owp-jellyfin-token \
  --trust-store /var/lib/openwatchparty/trust-store.json
```

List or revoke trusted keys:

```bash
sudo owpctl --scope system trust --store /var/lib/openwatchparty/trust-store.json list
sudo owpctl --scope system trust --store /var/lib/openwatchparty/trust-store.json revoke --kid KEY_ID
```

The RSA private key remains in Jellyfin's plugin data directory with owner-only permissions. The session server stores public keys only. `pair` reads or creates the plugin's current signing key and is safe to repeat; it does not rotate that key. Revoking a trusted key rejects later authentication attempts using tokens signed by it. Already-authenticated WebSocket sessions are not immediately disconnected by a trust-store edit; their existing expiry and reconnect rules still apply. There is no automated signing-key rotation command, so plan key replacement and pairing before revoking the active key.

## Managed Files

System scope:

```text
/etc/openwatchparty/owpctl.toml
/etc/openwatchparty/secrets.env
/var/lib/openwatchparty/state.json
/var/lib/openwatchparty/compose.yaml
/var/lib/openwatchparty/trust-store.json
/var/lib/openwatchparty/backups/
```

`uninstall` removes only resources marked as owned in `state.json`. Jellyfin itself and unrelated plugin repositories are never removed.
