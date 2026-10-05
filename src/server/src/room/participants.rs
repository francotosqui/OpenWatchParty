use crate::types::{Client, Room, WsMessage};
use crate::utils::now_ms;
use std::collections::HashMap;

/// Builds the `participant_list` message: the display names of the room's
/// members in join order, with the host flagged.
///
/// It is a message type of its own, rather than new fields on `room_state` or
/// `participants_update`, because clients validate those payloads strictly and
/// would drop them. A client that does not know `participant_list` ignores it
/// and keeps showing the participant count.
pub fn participant_list_message(room: &Room, clients: &HashMap<String, Client>) -> WsMessage {
    let participants: Vec<serde_json::Value> = room
        .clients
        .iter()
        .filter_map(|client_id| {
            clients.get(client_id).map(|client| {
                serde_json::json!({
                    "name": client.user_name,
                    "is_host": *client_id == room.host_id,
                })
            })
        })
        .collect();
    WsMessage {
        msg_type: "participant_list".to_string(),
        room: Some(room.room_id.clone()),
        client: None,
        payload: Some(serde_json::json!({ "participants": participants })),
        ts: now_ms(),
        server_ts: Some(now_ms()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers;

    #[test]
    fn lists_names_in_join_order_with_the_host_flagged() {
        let mut clients = HashMap::new();
        let (host, _host_rx) = test_helpers::create_client_with_rx("u1", "Franco", true);
        let (guest, _guest_rx) = test_helpers::create_client_with_rx("u2", "Ana", true);
        clients.insert("host".to_string(), host);
        clients.insert("guest".to_string(), guest);
        let mut room = test_helpers::create_room("room", "host");
        room.clients.push("guest".to_string());

        let message = participant_list_message(&room, &clients);

        assert_eq!(message.msg_type, "participant_list");
        assert_eq!(message.room.as_deref(), Some("room"));
        assert_eq!(
            message.payload.unwrap(),
            serde_json::json!({
                "participants": [
                    { "name": "Franco", "is_host": true },
                    { "name": "Ana", "is_host": false }
                ]
            })
        );
    }

    #[test]
    fn skips_members_without_a_connected_client() {
        let mut clients = HashMap::new();
        let (host, _host_rx) = test_helpers::create_client_with_rx("u1", "Franco", true);
        clients.insert("host".to_string(), host);
        let mut room = test_helpers::create_room("room", "host");
        room.clients.push("gone".to_string());

        let message = participant_list_message(&room, &clients);

        assert_eq!(
            message.payload.unwrap()["participants"],
            serde_json::json!([{ "name": "Franco", "is_host": true }])
        );
    }
}
