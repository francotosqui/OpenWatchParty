//! The open rooms as Jellyfin administrators see them on the plugin page.

use crate::messaging::{send_message, send_to_senders};
use crate::types::{Client, PlayState, ServerMessageType, ServerState, SharedState, WsMessage};
use crate::utils::now_ms;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AdminPerson {
    pub user_id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AdminRoom {
    pub room_id: String,
    pub name: String,
    pub opened_at_ms: u64,
    pub owner: Option<AdminPerson>,
    pub participants: Vec<AdminPerson>,
    pub media_id: Option<String>,
    pub playing: bool,
}

fn person(client: &Client) -> AdminPerson {
    AdminPerson {
        user_id: client.user_id.clone(),
        name: client.user_name.clone(),
    }
}

/// Every open room, oldest first. The Owner is the host's account, or the
/// account the room is waiting for while its host reconnects.
pub fn admin_rooms(state: &ServerState) -> Vec<AdminRoom> {
    let mut rooms: Vec<AdminRoom> = state
        .rooms
        .values()
        .map(|room| AdminRoom {
            room_id: room.room_id.clone(),
            name: room.name.clone(),
            opened_at_ms: room.opened_at_ms,
            owner: state.clients.get(&room.host_id).map(person).or_else(|| {
                room.pending_host_reconnect
                    .as_ref()
                    .map(|pending| AdminPerson {
                        user_id: pending.user_id.clone(),
                        name: pending.user_name.clone(),
                    })
            }),
            participants: room
                .clients
                .iter()
                .filter_map(|id| state.clients.get(id))
                .map(person)
                .collect(),
            media_id: room.media_id.clone(),
            playing: room.state.play_state == PlayState::Playing,
        })
        .collect();
    rooms.sort_by(|a, b| {
        a.opened_at_ms
            .cmp(&b.opened_at_ms)
            .then_with(|| a.room_id.cmp(&b.room_id))
    });
    rooms
}

pub fn admin_rooms_message(rooms: &[AdminRoom], now_ms: u64) -> WsMessage {
    WsMessage {
        msg_type: ServerMessageType::AdminRooms,
        room: None,
        client: None,
        payload: Some(serde_json::json!({ "server_now_ms": now_ms, "rooms": rooms })),
        ts: now_ms,
        server_ts: Some(now_ms),
    }
}

/// Sends the open rooms to one administrator connection.
pub async fn send_admin_rooms_to(client_id: &str, state: &SharedState) {
    let state = state.read().await;
    let sender = state
        .clients
        .get(client_id)
        .filter(|client| client.admin)
        .map(|client| client.sender.clone());
    let message = admin_rooms_message(&admin_rooms(&state), now_ms());
    drop(state);
    send_message(sender, &message, Some(client_id));
}

/// Sends the open rooms to every administrator connection.
pub async fn broadcast_admin_rooms(state: &SharedState) {
    let state = state.read().await;
    let senders: Vec<_> = state
        .clients
        .values()
        .filter(|client| client.admin)
        .map(|client| client.sender.clone())
        .collect();
    if senders.is_empty() {
        return;
    }
    let message = admin_rooms_message(&admin_rooms(&state), now_ms());
    drop(state);
    send_to_senders(&senders, &message, "admin rooms");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers;
    use crate::types::{PendingHostReconnect, PlayState, Room, ServerState};

    fn person(user_id: &str, name: &str) -> AdminPerson {
        AdminPerson {
            user_id: user_id.to_string(),
            name: name.to_string(),
        }
    }

    fn state_with_room() -> ServerState {
        let mut state = ServerState::default();
        let (host, _) = test_helpers::create_client_with_rx("u-ana", "Ana", true);
        let (guest, _) = test_helpers::create_client_with_rx("u-luz", "Luz", true);
        state.clients.insert("c-ana".to_string(), host);
        state.clients.insert("c-luz".to_string(), guest);
        let mut room = test_helpers::create_room("r1", "c-ana");
        room.name = "Movie night".to_string();
        room.clients.push("c-luz".to_string());
        room.media_id = Some("m1".to_string());
        room.state.play_state = PlayState::Playing;
        room.opened_at_ms = 5_000;
        state.rooms.insert("r1".to_string(), room);
        state
    }

    #[test]
    fn snapshot_lists_rooms_with_owner_people_media_and_state() {
        let rooms = admin_rooms(&state_with_room());

        assert_eq!(
            rooms,
            vec![AdminRoom {
                room_id: "r1".to_string(),
                name: "Movie night".to_string(),
                opened_at_ms: 5_000,
                owner: Some(person("u-ana", "Ana")),
                participants: vec![person("u-ana", "Ana"), person("u-luz", "Luz")],
                media_id: Some("m1".to_string()),
                playing: true,
            }]
        );
    }

    #[test]
    fn rooms_are_listed_oldest_first() {
        let mut state = state_with_room();
        let (other, _) = test_helpers::create_client_with_rx("u-pablo", "Pablo", true);
        state.clients.insert("c-pablo".to_string(), other);
        let mut older = test_helpers::create_room("r0", "c-pablo");
        older.opened_at_ms = 1_000;
        state.rooms.insert("r0".to_string(), older);

        let ids: Vec<String> = admin_rooms(&state).into_iter().map(|r| r.room_id).collect();
        assert_eq!(ids, vec!["r0", "r1"]);
    }

    #[test]
    fn owner_is_the_reconnecting_host() {
        let mut state = state_with_room();
        state.clients.remove("c-ana");
        let room = state.rooms.get_mut("r1").unwrap();
        room.clients.retain(|id| id != "c-ana");
        room.pending_host_reconnect = Some(PendingHostReconnect {
            user_id: "u-ana".to_string(),
            user_name: "Ana".to_string(),
            generation: 1,
        });

        let rooms = admin_rooms(&state);
        assert_eq!(rooms[0].owner, Some(person("u-ana", "Ana")));
        assert_eq!(rooms[0].participants, vec![person("u-luz", "Luz")]);
    }

    #[test]
    fn rooms_record_when_they_opened() {
        let room = Room::new(
            "r".to_string(),
            "c".to_string(),
            "Room".to_string(),
            None,
            0.0,
            1_000,
        );
        assert_eq!(room.opened_at_ms, 1_000);
    }

    #[test]
    fn the_message_carries_the_server_time_and_the_rooms() {
        let rooms = admin_rooms(&state_with_room());
        let message = admin_rooms_message(&rooms, 9_000);

        assert_eq!(
            message.msg_type,
            crate::types::ServerMessageType::AdminRooms
        );
        let payload = message.payload.unwrap();
        assert_eq!(payload["server_now_ms"], 9_000);
        assert_eq!(payload["rooms"][0]["name"], "Movie night");
        assert_eq!(payload["rooms"][0]["owner"]["name"], "Ana");
        assert_eq!(payload["rooms"][0]["playing"], true);
    }
}
