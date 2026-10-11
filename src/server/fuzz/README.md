# Inbound WebSocket fuzzing

The test-only crate compiles the server's production modules by path. It does
not duplicate JSON validation/dispatch or change the shipping binary. Keep its
dependency versions aligned with `../Cargo.toml`; its lockfile starts from the
server lockfile and adds only libFuzzer's dependencies.
CI verifies that the shared declarations and locked versions have not drifted.

Install and run on Linux:

```sh
rustup toolchain install nightly-2026-10-01 --profile minimal
cargo install cargo-fuzz --locked --version 0.13.1
cd src/server
RUSTFLAGS='' cargo +nightly-2026-10-01 fuzz run inbound_ws -- \
  -max_total_time=60 -max_len=65537 -rss_limit_mb=1024 -timeout=5
```

Run the committed corpus and production regression tests without a fuzzer:

```sh
cd src/server/fuzz
RUSTFLAGS='' cargo test --locked --lib
```

Each input starts an empty state and the actual Warp WebSocket route on an
ephemeral loopback port. The first byte selects raw wire bytes, masked text,
fragmented text with an interleaved ping, newline-separated command sequences,
binary, over-limit assembled messages/frames, or close frames. Bit 3 enables
JWT authentication (unauthenticated input then exercises rejection). A valid
create-room prefix in insecure mode reaches stateful dispatch; `$ROOM` in
sequence inputs is replaced with that room's id.

Input size, frame/message size, outbound channels, state cardinality and time
are bounded. Assertions check bidirectional room membership, unique members,
readiness/status membership, host ownership, valid positions, bounded names and
connection cleanup. Reconnect rooms intentionally retained at shutdown are
allowed only when empty and marked pending reconnect. libFuzzer's RSS limit
also fails excessive memory use. The panic hook aborts on panics in detached
Tokio tasks so they cannot silently escape the fuzzer.

`Server Hardening` runs a 30-second campaign on pull requests and a 300-second
campaign weekly. Failures upload `fuzz/artifacts/`. To reproduce:

```sh
RUSTFLAGS='' cargo +nightly-2026-10-01 fuzz run inbound_ws \
  fuzz/artifacts/inbound_ws/crash-REPRODUCER
```

Promote every server panic found to a normal deterministic server regression
test, fix it, and add the minimized input to the committed corpus (update
`.gitignore` and the corpus replay list). Sanitizer/timeouts caused by the
harness must be distinguished from server defects. A time-limited campaign
does not prove the absence of panics, leaks or state corruption.
