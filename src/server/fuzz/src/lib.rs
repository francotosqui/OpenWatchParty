//! Test-only crate compiling the production modules directly: no forked parser
//! or dispatch implementation, and no changes to the shipping server binary.
#![allow(dead_code)]
#[path = "../../src/auth.rs"]
mod auth;
#[path = "../../src/messaging.rs"]
mod messaging;
#[path = "../../src/metrics.rs"]
mod metrics;
#[path = "../../src/room/mod.rs"]
mod room;
#[path = "../../src/routes.rs"]
mod routes;
#[path = "../../src/tasks.rs"]
mod tasks;
#[cfg(test)]
#[path = "../../src/test_helpers.rs"]
mod test_helpers;
#[path = "../../src/trust.rs"]
mod trust;
#[path = "../../src/types.rs"]
mod types;
#[path = "../../src/utils.rs"]
mod utils;
#[path = "../../src/ws/mod.rs"]
mod ws;

use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::RwLock;
use warp::Filter;

const MAX_INPUT: usize = 65_537;
const BARRIER: &str = "OWP_FUZZ_BARRIER";

async fn check_state(state: &types::SharedState) {
    let locked = state.read().await;
    assert!(locked.clients.len() <= 1);
    assert!(locked.rooms.len() <= 1);
    for (id, client) in &locked.clients {
        if let Some(room_id) = &client.room_id {
            assert!(locked
                .rooms
                .get(room_id)
                .is_some_and(|room| room.clients.contains(id)));
        }
    }
    for (id, room) in &locked.rooms {
        assert_eq!(id, &room.room_id);
        assert!(room.state.position.is_finite());
        assert!((0.0..=86_400.0).contains(&room.state.position));
        assert!(room.name.chars().count() <= 100 + "'s room".len());
        assert!(room.clients.len() <= 20);
        let unique: std::collections::HashSet<_> = room.clients.iter().collect();
        assert_eq!(unique.len(), room.clients.len());
        assert!(room.clients.contains(&room.host_id) || room.pending_host_reconnect.is_some());
        for member in &room.clients {
            assert!(locked
                .clients
                .get(member)
                .is_some_and(|client| client.room_id.as_ref() == Some(id)));
        }
        assert!(room
            .ready_clients
            .iter()
            .all(|member| room.clients.contains(member)));
        assert!(room
            .statuses
            .keys()
            .all(|member| room.clients.contains(member)));
    }
}

/// Run a bounded input against the actual HTTP upgrade, frame assembly,
/// validation and dispatch path on an ephemeral loopback port.
pub fn exercise(data: &[u8]) {
    if data.len() > MAX_INPUT || data.is_empty() {
        return;
    }
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        tokio::time::timeout(Duration::from_secs(3), exercise_async(data))
            .await
            .expect("inbound WebSocket case exceeded its time budget");
    });
}

fn frame(opcode: u8, final_frame: bool, body: &[u8]) -> Vec<u8> {
    let mut bytes = vec![opcode | if final_frame { 0x80 } else { 0 }];
    match body.len() {
        0..=125 => bytes.push(0x80 | body.len() as u8),
        126..=65535 => {
            bytes.push(0x80 | 126);
            bytes.extend_from_slice(&(body.len() as u16).to_be_bytes());
        }
        _ => {
            bytes.push(0x80 | 127);
            bytes.extend_from_slice(&(body.len() as u64).to_be_bytes());
        }
    }
    let mask = [0x11, 0x23, 0x35, 0x47];
    bytes.extend_from_slice(&mask);
    bytes.extend(body.iter().enumerate().map(|(i, b)| b ^ mask[i % 4]));
    bytes
}

async fn barrier(socket: &mut TcpStream) -> bool {
    let ping = format!(r#"{{"type":"ping","ts":0,"payload":"{BARRIER}"}}"#);
    if socket
        .write_all(&frame(1, true, ping.as_bytes()))
        .await
        .is_err()
    {
        return false;
    }
    // A rolling bounded buffer handles a barrier split across TCP reads.
    let mut tail = Vec::new();
    let mut bytes = [0; 4096];
    loop {
        match socket.read(&mut bytes).await {
            Ok(0) | Err(_) => return false,
            Ok(n) => {
                tail.extend_from_slice(&bytes[..n]);
                if tail.windows(BARRIER.len()).any(|w| w == BARRIER.as_bytes()) {
                    return true;
                }
                let retain = tail.len().saturating_sub(BARRIER.len());
                tail.drain(..retain);
            }
        }
    }
}

async fn exercise_async(data: &[u8]) {
    let state = Arc::new(RwLock::new(types::ServerState::default()));
    let tasks = tasks::AppTasks::new();
    let jwt = Arc::new(auth::JwtConfig {
        secret: "fuzz-only-secret-never-used-in-production".into(),
        audience: "fuzz".into(),
        issuer: "fuzz".into(),
        enabled: data[0] & 8 != 0,
    });
    let route = routes::build_ws_route_with_tasks(
        state.clone(),
        jwt,
        Arc::new(vec!["*".into()]),
        routes::IngressConfig::from_env().unwrap(),
        tasks.clone(),
    )
    .recover(routes::handle_rejection);
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let address = listener.local_addr().unwrap();
    let cancel = tasks.cancellation_token();
    let server = tokio::spawn(
        warp::serve(route)
            .incoming(listener)
            .graceful(cancel.cancelled_owned())
            .run(),
    );
    let mut socket = TcpStream::connect(address).await.unwrap();
    socket.write_all(b"GET /ws HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n").await.unwrap();
    let mut header = Vec::new();
    while !header.ends_with(b"\r\n\r\n") {
        header.push(socket.read_u8().await.unwrap());
        assert!(header.len() < 4096);
    }
    assert!(header.starts_with(b"HTTP/1.1 101"));
    // A valid prefix gives mutations access to room/playback dispatch rather
    // than spending all their time in JSON parsing. JWT mode stays unauthenticated.
    socket.write_all(&frame(1, true,
        br#"{"type":"create_room","ts":0,"payload":{"media_id":"0123456789abcdef0123456789abcdef"}}"#)).await.unwrap();
    assert!(barrier(&mut socket).await);
    let room_id = state
        .read()
        .await
        .rooms
        .keys()
        .next()
        .cloned()
        .unwrap_or_default();
    let body = &data[1..];
    let wire = match data[0] & 7 {
        0 => body.to_vec(), // Raw wire: masks, opcodes, lengths and partial frames.
        1 => frame(1, true, body), // Arbitrary text, including invalid UTF-8.
        2 => {
            let split = body.len() / 2;
            let mut wire = frame(1, false, &body[..split]);
            wire.extend(frame(9, true, b"ping"));
            wire.extend(frame(0, true, &body[split..]));
            wire
        }
        3 => {
            let mut wire = Vec::new();
            for message in body.split(|b| *b == b'\n').take(32) {
                let text = String::from_utf8_lossy(message).replace("$ROOM", &room_id);
                wire.extend(frame(1, true, text.as_bytes()));
            }
            wire
        }
        4 => frame(2, true, body),
        5 => frame(1, true, &vec![b'x'; 65_537]), // Assembled-message limit.
        6 => {
            let mut wire = frame(1, false, &vec![b'x'; 32_769]);
            wire.extend(frame(0, true, &vec![b'x'; 32_769]));
            wire
        }
        _ => frame(8, true, body),
    };
    // Invalid/truncated raw frames are expected to wait for more bytes. Half
    // close the write side after a barrier so they cannot hang the harness.
    let _ = socket.write_all(&wire).await;
    let _ = socket
        .write_all(&frame(
            1,
            true,
            format!(r#"{{"type":"ping","ts":0,"payload":"{BARRIER}"}}"#).as_bytes(),
        ))
        .await;
    let _ = socket.shutdown().await;
    let mut bytes = [0; 4096];
    while let Ok(n) = socket.read(&mut bytes).await {
        if n == 0 {
            break;
        }
        check_state(&state).await;
    }
    check_state(&state).await;
    drop(socket);
    tasks.cancel();
    tasks.wait().await;
    server.await.unwrap();
    let locked = state.read().await;
    // Every input starts fresh. All connections/rooms must be released;
    // bounded channels, wire size and libFuzzer RSS limits bound memory.
    assert!(locked.clients.is_empty(), "connection leaked after input");
    // A feature-aware host may leave a deliberately retained reconnect room.
    // Its timer was cancelled at shutdown; the fresh state is dropped here.
    assert!(
        locked
            .rooms
            .values()
            .all(|room| room.clients.is_empty() && room.pending_host_reconnect.is_some()),
        "unexpected room retained after input"
    );
}

#[cfg(test)]
mod harness_tests {
    use super::*;
    #[test]
    fn corpus_replays_through_real_websocket() {
        for name in [
            "text",
            "fragmented",
            "sequence",
            "binary",
            "raw",
            "oversized",
            "fragment_limit",
            "jwt",
        ] {
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("corpus/inbound_ws")
                .join(name);
            exercise(&std::fs::read(path).unwrap());
        }
    }
}
