#!/usr/bin/env python3
"""Create the documented Jellyfin users for the disposable local dev stack."""

import json
import os
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


BASE_URL = f"http://localhost:{os.environ.get('JELLYFIN_PORT', '8096')}"
PASSWORD = os.environ.get("OWP_DEV_PASSWORD", "owp-dev-test")
USERS = ("testhost", "testclient1", "testclient2")
PLUGIN_ID = "0f2fd0fd-09ff-4f49-9f1c-4a8f421a4b7d"
CLIENT = 'MediaBrowser Client="OpenWatchParty dev setup", Device="localhost", DeviceId="owp-dev-setup", Version="1.0"'


def request(path, data=None, token=None):
    headers = {"Authorization": CLIENT + (f', Token="{token}"' if token else "")}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = Request(
        BASE_URL + path,
        data=json.dumps(data).encode() if data is not None else None,
        headers=headers,
        method="POST" if data is not None else "GET",
    )
    with urlopen(req, timeout=10) as response:
        body = response.read()
        return json.loads(body) if body else None


def main():
    if not PASSWORD:
        raise RuntimeError("OWP_DEV_PASSWORD must not be empty")

    for attempt in range(60):
        try:
            info = request("/System/Info/Public")
            break
        except HTTPError as exc:
            if exc.code not in (404, 503):
                raise
        except (OSError, ValueError):
            pass
        if attempt == 59:
            raise RuntimeError("Jellyfin did not become ready within 120 seconds")
        time.sleep(2)

    if not info["StartupWizardCompleted"]:
        request("/Startup/User", {"Name": USERS[0], "Password": PASSWORD})
        request("/Startup/Complete", {})
        print("Initialized Jellyfin dev admin: testhost")

    try:
        auth = request("/Users/AuthenticateByName", {"Username": USERS[0], "Pw": PASSWORD})
    except HTTPError as exc:
        if exc.code in (401, 403):
            raise RuntimeError(
                "Cannot authenticate testhost. This Jellyfin configuration already has "
                "different credentials; use a fresh dev configuration or restore its password."
            ) from None
        raise

    token = auth["AccessToken"]
    users = {user["Name"].casefold() for user in request("/Users", token=token)}
    for name in USERS[1:]:
        if name.casefold() in users:
            print(f"Existing Jellyfin dev user: {name}")
            continue
        request("/Users/New", {"Name": name, "Password": PASSWORD}, token=token)
        print(f"Created Jellyfin dev user: {name}")

    config_path = f"/Plugins/{PLUGIN_ID}/Configuration"
    config = request(config_path, token=token)
    secret = os.environ.get("JWT_SECRET", "")
    desired = {
        "JwtSecret": secret,
        "AllowInsecureNoAuth": not bool(secret),
        "SessionServerUrl": f"ws://localhost:{os.environ.get('SESSION_SERVER_PORT', '3000')}/ws",
    }
    if any(config.get(key) != value for key, value in desired.items()):
        config.update(desired)
        request(config_path, config, token=token)
        print("Configured OpenWatchParty for the local session server")
    plugin_token = request("/OpenWatchParty/Token", token=token)
    if plugin_token["auth_enabled"] != bool(secret):
        raise RuntimeError("Plugin and session server authentication modes do not match")
    print("Jellyfin dev users ready: " + ", ".join(USERS))


if __name__ == "__main__":
    try:
        main()
    except (HTTPError, URLError, KeyError, ValueError, RuntimeError) as exc:
        print(f"Dev user provisioning failed: {exc}", file=sys.stderr)
        sys.exit(1)
