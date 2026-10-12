#!/usr/bin/env python3
"""Keep the source-including fuzz crate on the server's dependency graph."""
from pathlib import Path
import tomllib

ROOT = Path(__file__).resolve().parents[2]
SERVER = ROOT / "src/server"


def read(path):
    with path.open("rb") as source:
        return tomllib.load(source)


def main():
    server = read(SERVER / "Cargo.toml")["dependencies"]
    fuzz = read(SERVER / "fuzz/Cargo.toml")["dependencies"]
    for name, declaration in server.items():
        expected = {"version": declaration} if isinstance(declaration, str) else declaration
        actual = {"version": fuzz[name]} if isinstance(fuzz[name], str) else fuzz[name]
        for key, value in expected.items():
            if key == "features":
                assert set(value) <= set(actual.get(key, [])), f"Missing {name} features"
            else:
                assert actual.get(key) == value, f"Fuzz dependency differs: {name}.{key}"
    def packages(path):
        return {(p["name"], p["version"], p.get("source")) for p in read(path)["package"] if p.get("source")}
    assert packages(SERVER / "Cargo.lock") <= packages(SERVER / "fuzz/Cargo.lock"), "Fuzz lockfile drifted from server"
    print("Fuzz dependencies preserve the server's declarations and locked versions.")


if __name__ == "__main__":
    main()
