use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::TcpListener,
    process::{Command, Output, Stdio},
    thread,
};
use tempfile::TempDir;
use tungstenite::Message;

struct Fixture {
    root: TempDir,
    url: String,
    threads: Vec<thread::JoinHandle<()>>,
}

fn room() -> Value {
    json!({"room_id":"r1", "name":"Movie night", "opened_at_ms":1000,
        "owner":{"user_id":"ana","name":"Ana"},
        "participants":[{"user_id":"ana","name":"Ana"},{"user_id":"luz","name":"Luz"}],
        "media_id":"m1", "playing":true})
}

impl Fixture {
    fn new(rooms: Vec<Value>, close_error: Option<&'static str>, supported: bool) -> Self {
        Self::with_ws_bind(rooms, close_error, supported, "127.0.0.1:0")
    }

    fn with_ws_bind(
        rooms: Vec<Value>,
        close_error: Option<&'static str>,
        supported: bool,
        bind: &str,
    ) -> Self {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("token"), "jellyfin-test-secret\n").unwrap();
        let http = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/jellyfin/", http.local_addr().unwrap());
        let ws = TcpListener::bind(bind).unwrap();
        let ws_url = format!("ws://{}/ws", ws.local_addr().unwrap());
        let http_thread = thread::spawn(move || {
            let (mut stream, _) = http.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut request = Vec::new();
            loop {
                let mut b = [0; 1];
                stream.read_exact(&mut b).unwrap();
                request.push(b[0]);
                if request.ends_with(b"\r\n\r\n") {
                    break;
                }
            }
            let request = String::from_utf8(request).unwrap();
            assert!(request.starts_with("GET /jellyfin/OpenWatchParty/AdminToken HTTP/1.1"));
            assert!(request.contains("jellyfin-test-secret"));
            let body = json!({"token":"admin-test-secret","expires_in":300,"protocol_version":1,"session_server_url":ws_url}).to_string();
            write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
        });
        let ws_thread = thread::spawn(move || {
            let (stream, _) = ws.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut socket = tungstenite::accept_hdr(
                stream,
                |request: &tungstenite::handshake::server::Request, response| {
                    assert!(request
                        .headers()
                        .get("Origin")
                        .unwrap()
                        .to_str()
                        .unwrap()
                        .starts_with("http://127.0.0.1:"));
                    Ok(response)
                },
            )
            .unwrap();
            send(&mut socket, json!({"type":"client_hello","payload":{}}));
            let auth: Value =
                serde_json::from_str(socket.read().unwrap().to_text().unwrap()).unwrap();
            assert_eq!(auth["type"], "auth");
            assert_eq!(auth["payload"]["token"], "admin-test-secret");
            assert_eq!(auth["payload"]["features"], json!(["room_dashboard"]));
            send(
                &mut socket,
                json!({"type":"auth_success","payload":{"features":if supported {json!(["room_dashboard"])} else {json!([])}}}),
            );
            if !supported {
                return;
            }
            send(
                &mut socket,
                json!({"type":"admin_rooms","payload":{"server_now_ms":121000,"rooms":rooms}}),
            );
            if let Ok(Message::Text(message)) = socket.read() {
                let request: Value = serde_json::from_str(&message).unwrap();
                assert_eq!(request["type"], "admin_close_room");
                assert_eq!(request["payload"]["room_id"], "r1");
                if let Some(code) = close_error {
                    send(
                        &mut socket,
                        json!({"type":"error","payload":{"code":code,"message":"do not expose admin-test-secret"}}),
                    );
                } else {
                    // The old snapshot must not be mistaken for successful close.
                    send(
                        &mut socket,
                        json!({"type":"admin_rooms","payload":{"server_now_ms":122000,"rooms":[room()]}}),
                    );
                    send(
                        &mut socket,
                        json!({"type":"admin_rooms","payload":{"server_now_ms":123000,"rooms":[]}}),
                    );
                }
            }
        });
        Self {
            root,
            url,
            threads: vec![http_thread, ws_thread],
        }
    }

    fn run(&self, action: &[&str], json: bool) -> Output {
        let mut command = Command::new(env!("CARGO_BIN_EXE_owpctl"));
        command.arg("--root").arg(self.root.path());
        if json {
            command.arg("--json");
        }
        command
            .arg("rooms")
            .args(action)
            .arg("--jellyfin-url")
            .arg(&self.url)
            .arg("--api-token-file")
            .arg(self.root.path().join("token"))
            .stdin(Stdio::null())
            .output()
            .unwrap()
    }

    fn finish(self) {
        for handle in self.threads {
            handle.join().unwrap();
        }
    }
}

fn send(socket: &mut tungstenite::WebSocket<std::net::TcpStream>, value: Value) {
    socket
        .send(Message::Text(value.to_string().into()))
        .unwrap();
}

#[test]
fn lists_rooms_as_json_using_the_administrator_endpoint() {
    let fixture = Fixture::new(vec![room()], None, true);
    let output = fixture.run(&["list"], true);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let result: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(result["rooms"][0]["room_id"], "r1");
    assert_eq!(result["rooms"][0]["owner"]["name"], "Ana");
    assert_eq!(
        result["rooms"][0]["participants"].as_array().unwrap().len(),
        2
    );
    assert!(!String::from_utf8_lossy(&output.stdout).contains("secret"));
    fixture.finish();
}

#[test]
fn human_list_says_when_empty() {
    let fixture = Fixture::new(vec![], None, true);
    let output = fixture.run(&["list"], false);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("No rooms open"));
    fixture.finish();
}

#[test]
fn closes_only_after_yes_and_waits_for_the_room_to_disappear() {
    let fixture = Fixture::new(vec![room()], None, true);
    let output = fixture.run(&["close", "r1", "--yes"], true);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        serde_json::from_slice::<Value>(&output.stdout).unwrap(),
        json!({"closed":true,"room_id":"r1"})
    );
    fixture.finish();
}

#[test]
fn noninteractive_close_requires_yes_without_connecting() {
    let root = tempfile::tempdir().unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_owpctl"))
        .arg("--root")
        .arg(root.path())
        .args(["rooms", "close", "r1"])
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("--yes"));
}

#[test]
fn reports_saving_error_without_leaking_server_text() {
    let fixture = Fixture::new(vec![room()], Some("ROOM_SAVE_IN_PROGRESS"), true);
    let output = fixture.run(&["close", "r1", "--yes"], true);
    assert!(!output.status.success());
    let error = String::from_utf8_lossy(&output.stderr);
    assert!(error.contains("being saved"), "{error}");
    assert!(!error.contains("secret"));
    fixture.finish();
}

#[test]
fn detects_an_older_server() {
    let fixture = Fixture::new(vec![], None, false);
    let output = fixture.run(&["list"], true);
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("update"));
    fixture.finish();
}

#[test]
fn refuses_to_close_an_id_not_present_in_the_snapshot() {
    let fixture = Fixture::new(vec![], None, true);
    let output = fixture.run(&["close", "r1", "--yes"], true);
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("Room not found"));
    fixture.finish();
}

#[test]
fn human_list_keeps_untrusted_names_on_one_terminal_line() {
    let mut entry = room();
    entry["name"] = json!("Movie\n\u{1b}[2J");
    let fixture = Fixture::new(vec![entry], None, true);
    let output = fixture.run(&["list"], false);
    assert!(output.status.success());
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.contains("Movie  [2J"));
    assert!(text.contains("Owner: Ana | 2 people: Ana, Luz"));
    assert!(text.contains("Playing | media: m1 | open for 2 min"));
    assert!(!text.contains('\u{1b}'));
    fixture.finish();
}

#[test]
fn uses_the_managed_configuration_when_url_is_not_overridden() {
    let fixture = Fixture::new(vec![], None, true);
    let paths =
        owpctl::paths::Paths::resolve(owpctl::cli::ScopeArg::User, Some(fixture.root.path()))
            .unwrap();
    let config =
        owpctl::config::DesiredConfig::local(url::Url::parse(&fixture.url).unwrap()).unwrap();
    owpctl::storage::write_toml(&paths.config_file, &config).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_owpctl"))
        .arg("--root")
        .arg(fixture.root.path())
        .args(["--json", "rooms", "list", "--api-token-file"])
        .arg(fixture.root.path().join("token"))
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        serde_json::from_slice::<Value>(&output.stdout).unwrap()["rooms"],
        json!([])
    );
    fixture.finish();
}

#[test]
fn refuses_a_nonadministrator_without_printing_the_response_body() {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("token"), "user-secret").unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = [0; 4096];
        assert!(stream.read(&mut request).unwrap() > 0);
        let body = r#"{"error":"user-secret"}"#;
        write!(stream, "HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
    });
    let output = Command::new(env!("CARGO_BIN_EXE_owpctl"))
        .arg("--root")
        .arg(root.path())
        .args(["rooms", "list", "--jellyfin-url", &url, "--api-token-file"])
        .arg(root.path().join("token"))
        .output()
        .unwrap();
    assert!(!output.status.success());
    let text = String::from_utf8_lossy(&output.stderr);
    assert!(text.contains("administrator access"));
    assert!(text.contains("403"));
    assert!(!text.contains("user-secret"));
    server.join().unwrap();
}

#[test]
fn lists_rooms_over_ipv6() {
    let fixture = Fixture::with_ws_bind(vec![room()], None, true, "[::1]:0");
    let output = fixture.run(&["list"], true);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        serde_json::from_slice::<Value>(&output.stdout).unwrap()["rooms"][0]["room_id"],
        "r1"
    );
    fixture.finish();
}
