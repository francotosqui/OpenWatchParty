#!/usr/bin/env python3
"""Fetch small Blender open movies into the ignored local Jellyfin library."""

import hashlib
import os
import tempfile
from pathlib import Path
from urllib.request import urlopen


MOVIES = Path(__file__).resolve().parents[2] / "media/dev/Movies"
# Internet Archive mirrors of Blender Studio's CC BY 4.0 open movies.
# Keep the filenames, sizes and checksums pinned to make setup reproducible.
FILMS = (
    (
        "Wing It! (2023).mp4",
        "https://archive.org/download/wing_it/wing_it.mp4",
        65577790,
        "6e57e8d0a0d746c04ae1024f1680a53c3b4b24e4cb58ae0bd24e28a9385ee124",
    ),
    (
        "Sprite Fright (2021).mp4",
        "https://archive.org/download/sprite-fright/Sprite%20Fright%20-%20Open%20Movie%20by%20Blender%20Studio-804p.mp4",
        110581245,
        "85af52d5f82976256d5f091aea4cf276a3d8599d14d36bae5d51e43a9acfd076",
    ),
)


def matches(path, size, digest):
    if not path.is_file() or path.stat().st_size != size:
        return False
    checksum = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            checksum.update(chunk)
    return checksum.hexdigest() == digest


def main():
    MOVIES.mkdir(parents=True, exist_ok=True)
    for filename, url, size, digest in FILMS:
        destination = MOVIES / filename
        if matches(destination, size, digest):
            destination.chmod(0o644)
            print(f"Dev media ready: {filename}")
            continue
        if destination.exists():
            raise RuntimeError(f"Existing dev media is incomplete or modified: {destination}")

        print(f"Downloading {filename} ({size // 1_000_000} MB)...", flush=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=MOVIES, prefix=".download-", delete=False) as output:
                temporary = Path(output.name)
                with urlopen(url, timeout=60) as source:
                    remaining = size
                    while chunk := source.read(min(1024 * 1024, remaining + 1)):
                        output.write(chunk)
                        remaining -= len(chunk)
                        if remaining < 0:
                            raise RuntimeError(f"Download exceeds expected size: {filename}")
            if not matches(temporary, size, digest):
                raise RuntimeError(f"Download checksum or size mismatch: {filename}")
            temporary.chmod(0o644)
            os.replace(temporary, destination)
            print(f"Dev media ready: {filename}")
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
