//! One-shot administrative room operations over the player's existing /ws route.
use std::{
    io::{self, IsTerminal},
    net::TcpStream,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use anyhow::{bail, Context};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tungstenite::{client::IntoClientRequest, stream::MaybeTlsStream, Message, WebSocket};
use url::Url;

use crate::{
    cli::{RoomConnectionArgs, RoomsArgs, RoomsCommand},
    config::DesiredConfig,
    jellyfin::{AdministratorToken, JellyfinClient},
    output::Summary,
    paths::Paths,
};

const TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Deserialize, Serialize)]
pub struct Person {
    pub user_id: String,
    pub name: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Room {
    pub room_id: String,
    pub name: String,
    pub opened_at_ms: u64,
    pub owner: Option<Person>,
    pub participants: Vec<Person>,
    pub media_id: Option<String>,
    pub playing: bool,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Snapshot {
    pub server_now_ms: u64,
    pub rooms: Vec<Room>,
}

impl Summary for Snapshot {
    fn summary(&self) -> String {
        if self.rooms.is_empty() {
            return "No rooms open right now.\n".to_string();
        }
        let mut text = String::new();
        for room in &self.rooms {
            let owner = room.owner.as_ref().map(|p| p.name.as_str()).unwrap_or("-");
            let names = room
                .participants
                .iter()
                .map(|p| terminal_text(&p.name))
                .collect::<Vec<_>>()
                .join(", ");
            let minutes = self.server_now_ms.saturating_sub(room.opened_at_ms) / 60_000;
            text.push_str(&format!(
                "{}  {}\n  Owner: {} | {}: {}\n  {} | media: {} | open for {} min\n",
                terminal_text(&room.room_id),
                terminal_text(&room.name),
                terminal_text(owner),
                people(room.participants.len()),
                names,
                if room.playing { "Playing" } else { "Paused" },
                terminal_text(room.media_id.as_deref().unwrap_or("-")),
                minutes,
            ));
        }
        text
    }
}

fn people(count: usize) -> String {
    if count == 1 {
        "1 person".to_string()
    } else {
        format!("{count} people")
    }
}

/// The plugin returns an empty session server URL when it uses same-host
/// detection; like the web page, connect to the Jellyfin host on port 3000.
fn session_url(jellyfin: &Url, returned: &str) -> anyhow::Result<Url> {
    if returned.trim().is_empty() {
        let scheme = if jellyfin.scheme() == "https" {
            "wss"
        } else {
            "ws"
        };
        let host = jellyfin
            .host_str()
            .context("the Jellyfin URL has no host")?;
        return Url::parse(&format!("{scheme}://{host}:3000/ws"))
            .context("cannot derive the same-host session server URL");
    }
    Url::parse(returned).context("plugin returned an invalid session server URL")
}

// Room/account names come from other users, not the operator's terminal.
fn terminal_text(text: &str) -> String {
    text.chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect()
}

pub fn run(paths: &Paths, args: RoomsArgs, as_json: bool) -> anyhow::Result<()> {
    let (connection, closing) = match &args.command {
        RoomsCommand::List(connection) => (connection, None),
        RoomsCommand::Close {
            connection,
            room_id,
            yes,
        } => {
            if !yes && (as_json || !io::stdin().is_terminal()) {
                bail!("closing a room requires --yes with --json or non-interactive input");
            }
            (connection, Some((room_id.as_str(), *yes)))
        }
    };
    let (base, origin) = connection_urls(paths, connection)?;
    let file = connection
        .api_token_file
        .as_deref()
        .context("--api-token-file is required for room administration")?;
    let token = JellyfinClient::token_from_file(file)?;
    let client = JellyfinClient::new(base.clone())?.with_token(token);
    let mut session = open_session(&client, &base, &origin)?;
    let snapshot = session.snapshot()?;
    if let Some((room_id, yes)) = closing {
        let room = snapshot
            .rooms
            .iter()
            .find(|r| r.room_id == room_id)
            .context("Room not found; run `owpctl rooms list` again")?;
        if yes {
            session.close_room(room_id)?;
        } else if !interactive_close(session, room, &client, &base, &origin, |room| {
            Ok(dialoguer::Confirm::new()
                .with_prompt(format!(
                    "Close '{}' ({}, {})? Members will leave the room",
                    terminal_text(&room.name),
                    terminal_text(&room.room_id),
                    people(room.participants.len())
                ))
                .default(false)
                .interact()?)
        })? {
            println!("Room left open.");
            return Ok(());
        }
        crate::output::print(&json!({"closed":true,"room_id":room_id}), as_json)
    } else {
        crate::output::print(&snapshot, as_json)
    }
}

fn interactive_close(
    session: Session,
    room: &Room,
    client: &JellyfinClient,
    base: &Url,
    origin: &Url,
    confirm: impl FnOnce(&Room) -> anyhow::Result<bool>,
) -> anyhow::Result<bool> {
    // A prompt can outlive both the heartbeat and the administrator JWT.
    // Keep no idle socket while waiting; re-check credentials and room afterward.
    drop(session);
    if !confirm(room)? {
        return Ok(false);
    }
    let mut session = open_session(client, base, origin)?;
    let current = session.snapshot()?;
    if !current.rooms.iter().any(|r| r.room_id == room.room_id) {
        bail!("Room not found; it may have closed while awaiting confirmation");
    }
    session.close_room(&room.room_id)?;
    Ok(true)
}

fn open_session(client: &JellyfinClient, base: &Url, origin: &Url) -> anyhow::Result<Session> {
    let access = client.administrator_token()?;
    let url = session_url(base, &access.session_server_url)?;
    Session::connect(origin, &url, access)
}

fn connection_urls(paths: &Paths, connection: &RoomConnectionArgs) -> anyhow::Result<(Url, Url)> {
    let (base, origin) = if let Some(base) = &connection.jellyfin_url {
        (base.clone(), base.clone())
    } else {
        let config: DesiredConfig = crate::storage::read_toml(&paths.config_file)
            .context("run `owpctl setup` first or pass --jellyfin-url")?;
        (config.jellyfin.base_url, config.jellyfin.public_origin)
    };
    if !matches!(base.scheme(), "http" | "https")
        || !base.username().is_empty()
        || base.password().is_some()
    {
        bail!("Jellyfin URL must be HTTP(S) without embedded credentials");
    }
    Ok((base, origin))
}

struct Session {
    socket: WebSocket<MaybeTlsStream<TcpStream>>,
    deadline: Instant,
}

impl Session {
    fn connect(origin: &Url, url: &Url, access: AdministratorToken) -> anyhow::Result<Self> {
        if !matches!(url.scheme(), "ws" | "wss")
            || !url.username().is_empty()
            || url.password().is_some()
        {
            bail!("plugin returned an invalid session server URL");
        }
        let addresses = url
            .socket_addrs(|| None)
            .context("cannot resolve session server")?;
        let deadline = Instant::now() + TIMEOUT;
        let mut stream = None;
        for address in addresses {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }
            if let Ok(connected) = TcpStream::connect_timeout(&address, remaining) {
                connected.set_read_timeout(Some(remaining))?;
                connected.set_write_timeout(Some(remaining))?;
                stream = Some(connected);
                break;
            }
        }
        let stream = stream.context("cannot connect to session server")?;
        let mut request = url
            .as_str()
            .into_client_request()
            .context("invalid session server URL")?;
        request
            .headers_mut()
            .insert("Origin", origin.origin().ascii_serialization().parse()?);
        let (socket, _) = tungstenite::client_tls(request, stream).map_err(|_| {
            anyhow::anyhow!(
                "session server WebSocket connection failed; check the proxy and allowed origin"
            )
        })?;
        let mut session = Self {
            socket,
            deadline: Instant::now() + TIMEOUT,
        };
        session.send(json!({"type":"auth","payload":{"token":access.token,"protocol_version":access.protocol_version,"features":["room_dashboard"]}}))?;
        loop {
            let message = session.receive()?;
            if message["type"] == "auth_success" {
                let supported = message["payload"]["features"]
                    .as_array()
                    .is_some_and(|features| features.iter().any(|f| f == "room_dashboard"));
                if !supported {
                    bail!("session server does not support room administration; update it");
                }
                return Ok(session);
            }
        }
    }

    fn send(&mut self, mut message: Value) -> anyhow::Result<()> {
        message["ts"] = json!(SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64);
        self.socket
            .send(Message::Text(message.to_string().into()))
            .map_err(|_| anyhow::anyhow!("session server connection closed while sending command"))
    }

    fn receive(&mut self) -> anyhow::Result<Value> {
        loop {
            let remaining = self.deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                bail!("timed out waiting for the session server");
            }
            let stream = match self.socket.get_mut() {
                MaybeTlsStream::Plain(stream) => stream,
                MaybeTlsStream::Rustls(stream) => stream.get_mut(),
                _ => bail!("unsupported WebSocket transport"),
            };
            stream.set_read_timeout(Some(remaining))?;
            stream.set_write_timeout(Some(remaining))?;
            let frame = self
                .socket
                .read()
                .map_err(|_| anyhow::anyhow!("session server disconnected or timed out"))?;
            if let Message::Text(text) = frame {
                let message: Value =
                    serde_json::from_str(&text).context("invalid session server response")?;
                if message["type"] == "error" {
                    return Err(server_error(
                        message["payload"]["code"].as_str().unwrap_or("UNKNOWN"),
                    ));
                }
                return Ok(message);
            }
            if frame.is_close() {
                bail!("session server closed the connection");
            }
            // tungstenite queues pong replies for protocol heartbeat pings.
            self.socket
                .flush()
                .map_err(|_| anyhow::anyhow!("session server connection closed"))?;
        }
    }

    fn snapshot(&mut self) -> anyhow::Result<Snapshot> {
        loop {
            let message = self.receive()?;
            if message["type"] == "admin_rooms" {
                return serde_json::from_value(message["payload"].clone())
                    .context("invalid administrator room snapshot");
            }
        }
    }

    fn close_room(&mut self, room_id: &str) -> anyhow::Result<()> {
        // A human may take longer than the network deadline to confirm.
        self.deadline = Instant::now() + TIMEOUT;
        self.send(json!({"type":"admin_close_room","payload":{"room_id":room_id}}))?;
        loop {
            if self
                .snapshot()?
                .rooms
                .iter()
                .all(|room| room.room_id != room_id)
            {
                return Ok(());
            }
        }
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        let _ = self.socket.close(None);
    }
}

fn server_error(code: &str) -> anyhow::Error {
    anyhow::anyhow!(match code {
        "ROOM_SAVE_IN_PROGRESS" => "The room is being saved; try again in a moment",
        "ROOM_NOT_FOUND" => "Room not found; it may already have been closed",
        "AUTHENTICATION_FAILED"
        | "AUTHENTICATION_EXPIRED"
        | "AUTHENTICATION_REQUIRED"
        | "AUTHENTICATION_TIMEOUT" =>
            "administrator authentication failed; obtain a new Jellyfin administrator access token",
        "ADMIN_PERMISSION_REQUIRED" | "ADMIN_CONNECTION_RESTRICTED" =>
            "administrator permission required",
        _ => "session server rejected the room operation",
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };

    #[test]
    fn same_host_detection_uses_the_jellyfin_host_and_port_3000() {
        let url = |base: &str, returned: &str| {
            session_url(&Url::parse(base).unwrap(), returned).map(|url| url.to_string())
        };
        assert_eq!(
            url("http://media.local:8096/", "").unwrap(),
            "ws://media.local:3000/ws"
        );
        assert_eq!(
            url("https://example.org/jellyfin/", " ").unwrap(),
            "wss://example.org:3000/ws"
        );
        assert_eq!(url("http://[::1]:8096/", "").unwrap(), "ws://[::1]:3000/ws");
        assert_eq!(
            url("https://example.org/", "wss://rooms.example.org/ws").unwrap(),
            "wss://rooms.example.org/ws"
        );
        assert!(url("https://example.org/", "not a url").is_err());
    }

    #[test]
    fn people_counts_one_person() {
        assert_eq!(people(1), "1 person");
        assert_eq!(people(2), "2 people");
        assert_eq!(people(0), "0 people");
    }

    #[test]
    fn confirmation_refreshes_access_and_reconnects_before_closing() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let ws_url = format!("ws://{}/ws", listener.local_addr().unwrap());
        let http = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = Url::parse(&format!("http://{}/", http.local_addr().unwrap())).unwrap();
        let origin = base.clone();
        let refreshed_url = ws_url.clone();
        let endpoint = thread::spawn(move || {
            let (mut stream, _) = http.accept().unwrap();
            let mut request = [0; 4096];
            assert!(stream.read(&mut request).unwrap() > 0);
            let body = json!({"token":"fresh-admin","protocol_version":1,"session_server_url":refreshed_url}).to_string();
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .unwrap();
        });
        let server = thread::spawn(move || {
            for index in 0..2 {
                let (stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut socket = tungstenite::accept(stream).unwrap();
                let auth: Value =
                    serde_json::from_str(socket.read().unwrap().to_text().unwrap()).unwrap();
                assert_eq!(
                    auth["payload"]["token"],
                    if index == 0 {
                        "initial-admin"
                    } else {
                        "fresh-admin"
                    }
                );
                socket
                    .send(Message::Text(
                        json!({"type":"auth_success","payload":{"features":["room_dashboard"]}})
                            .to_string()
                            .into(),
                    ))
                    .unwrap();
                socket.send(Message::Text(json!({"type":"admin_rooms","payload":{"server_now_ms":1000,"rooms":[{"room_id":"r1","name":"Room","opened_at_ms":1000,"owner":null,"participants":[],"media_id":null,"playing":false}]}}).to_string().into())).unwrap();
                if index == 0 {
                    // Model the server expiring the connection during a long prompt.
                    socket.close(None).unwrap();
                } else {
                    let close: Value =
                        serde_json::from_str(socket.read().unwrap().to_text().unwrap()).unwrap();
                    assert_eq!(close["type"], "admin_close_room");
                    socket.send(Message::Text(json!({"type":"admin_rooms","payload":{"server_now_ms":2000,"rooms":[]}}).to_string().into())).unwrap();
                }
            }
        });
        let mut session = Session::connect(
            &origin,
            &Url::parse(&ws_url).unwrap(),
            AdministratorToken {
                token: "initial-admin".into(),
                session_server_url: ws_url.clone(),
                protocol_version: 1,
            },
        )
        .unwrap();
        let snapshot = session.snapshot().unwrap();
        let client = JellyfinClient::new(base.clone())
            .unwrap()
            .with_token("user-token");
        let result =
            interactive_close(session, &snapshot.rooms[0], &client, &base, &origin, |_| {
                Ok(true)
            });
        assert!(result.is_ok(), "{result:?}");
        assert!(result.unwrap());
        endpoint.join().unwrap();
        server.join().unwrap();
    }
}
