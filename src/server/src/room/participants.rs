use crate::types::{Client, Room, RoomPermissions, ServerMessageType, WsMessage};
use crate::utils::now_ms;
use std::collections::HashMap;

pub(crate) fn send_room_administrator(
    room: &Room,
    clients: &HashMap<String, Client>,
    only: Option<&str>,
) {
    let participant_ids = room
        .clients
        .iter()
        .filter(|id| {
            clients.get(*id).is_some_and(|client| {
                !client.user_id.is_empty()
                    && room.administrator_user_id.as_deref() == Some(client.user_id.as_str())
            })
        })
        .cloned()
        .collect::<Vec<_>>();
    let senders = room
        .clients
        .iter()
        .filter(|id| only.is_none_or(|only| only == id.as_str()))
        .filter_map(|id| clients.get(id))
        .filter(|client| client.supports_room_administrator)
        .map(|client| client.sender.clone())
        .collect::<Vec<_>>();
    crate::messaging::send_to_senders(
        &senders,
        &WsMessage {
            msg_type: ServerMessageType::RoomAdministrator,
            room: Some(room.room_id.clone()),
            client: None,
            payload: Some(
                serde_json::json!({"user_id": room.administrator_user_id, "participant_ids": participant_ids}),
            ),
            ts: now_ms(),
            server_ts: Some(now_ms()),
        },
        "room administrator",
    );
}

#[cfg(test)]
mod administrator_notification_tests {
    use super::*;
    use crate::test_helpers::{create_client_with_rx, create_room, recv_msg};

    #[test]
    fn administrator_state_reaches_only_feature_aware_members() {
        let (mut owner, mut owner_rx) = create_client_with_rx("owner", "Owner", true);
        let (legacy, mut legacy_rx) = create_client_with_rx("legacy", "Legacy", true);
        owner.supports_room_administrator = true;
        let mut room = create_room("room", "owner");
        room.clients.push("legacy".into());
        room.administrator_user_id = Some("legacy".into());
        let clients = HashMap::from([("owner".into(), owner), ("legacy".into(), legacy)]);

        send_room_administrator(&room, &clients, None);

        let message = recv_msg(&mut owner_rx).unwrap();
        assert_eq!(message.msg_type, ServerMessageType::RoomAdministrator);
        assert_eq!(message.payload.unwrap()["user_id"], "legacy");
        assert!(recv_msg(&mut legacy_rx).is_none());
    }
}

pub(crate) struct ParticipantListNotification {
    legacy_senders: Vec<crate::messaging::ClientSender>,
    moderation_senders: Vec<crate::messaging::ClientSender>,
    legacy_message: WsMessage,
    moderation_message: WsMessage,
}

/// Sent only to clients that negotiated this extension: legacy payloads stay
/// unchanged, and shared controls follow the current host's capability.
pub(crate) fn send_room_capabilities(room: &Room, clients: &HashMap<String, Client>) {
    let enabled = clients
        .get(&room.host_id)
        .is_some_and(|client| client.supports_shared_playback_control);
    let features: Vec<&str> = if enabled {
        vec!["shared_playback_control"]
    } else {
        vec![]
    };
    let senders = room
        .clients
        .iter()
        .filter_map(|id| clients.get(id))
        .filter(|client| client.supports_shared_playback_control)
        .map(|client| client.sender.clone())
        .collect::<Vec<_>>();
    crate::messaging::send_to_senders(
        &senders,
        &WsMessage {
            msg_type: ServerMessageType::RoomCapabilities,
            room: Some(room.room_id.clone()),
            client: None,
            payload: Some(serde_json::json!({ "features": features })),
            ts: now_ms(),
            server_ts: Some(now_ms()),
        },
        "room capabilities",
    );
}

/// What the host lets guests do, as `room_permissions`, to the room's
/// members (or `only` that one) that negotiated the feature. Older clients
/// keep today's rules and would reject the message.
pub(crate) fn send_room_permissions(
    room: &Room,
    clients: &HashMap<String, Client>,
    only: Option<&str>,
) {
    let senders = room
        .clients
        .iter()
        .filter(|id| only.is_none_or(|only| only == id.as_str()))
        .filter_map(|id| clients.get(id))
        .filter(|client| client.supports_room_permissions)
        .map(|client| client.sender.clone())
        .collect::<Vec<_>>();
    crate::messaging::send_to_senders(
        &senders,
        &WsMessage {
            msg_type: ServerMessageType::RoomPermissions,
            room: Some(room.room_id.clone()),
            client: None,
            payload: Some(
                serde_json::to_value(room.permissions).expect("typed permissions serialize"),
            ),
            ts: now_ms(),
            server_ts: Some(now_ms()),
        },
        "room permissions",
    );
}

/// After the host changes: a host without the feature can neither see nor
/// change the permissions, so they go back to today's rules.
pub(crate) fn reset_room_permissions_for_host(room: &mut Room, clients: &HashMap<String, Client>) {
    if room.permissions == RoomPermissions::default()
        || clients
            .get(&room.host_id)
            .is_some_and(|client| client.supports_room_permissions)
    {
        return;
    }
    room.permissions = Default::default();
    send_room_permissions(room, clients, None);
}

#[cfg(test)]
mod capability_tests {
    use super::*;
    use crate::test_helpers;

    #[test]
    fn capabilities_follow_the_host_and_never_reach_legacy_clients() {
        let (host, mut host_rx) = test_helpers::create_client_with_rx("host", "Host", true);
        let (mut guest, mut guest_rx) = test_helpers::create_client_with_rx("guest", "Guest", true);
        guest.supports_shared_playback_control = true;
        let mut room = test_helpers::create_room("r1", "host");
        room.clients.push("guest".into());
        let mut clients = HashMap::from([("host".into(), host), ("guest".into(), guest)]);
        send_room_capabilities(&room, &clients);
        assert_eq!(
            test_helpers::recv_msg(&mut guest_rx)
                .unwrap()
                .payload
                .unwrap()["features"],
            serde_json::json!([])
        );
        assert!(test_helpers::recv_msg(&mut host_rx).is_none());
        room.host_id = "guest".into();
        send_room_capabilities(&room, &clients);
        assert_eq!(
            test_helpers::recv_msg(&mut guest_rx)
                .unwrap()
                .payload
                .unwrap()["features"],
            serde_json::json!(["shared_playback_control"])
        );
        assert!(test_helpers::recv_msg(&mut host_rx).is_none());
        clients
            .get_mut("guest")
            .unwrap()
            .supports_shared_playback_control = false;
        send_room_capabilities(&room, &clients);
        assert!(test_helpers::recv_msg(&mut guest_rx).is_none());
    }
}

#[cfg(test)]
mod permission_tests {
    use super::*;
    use crate::test_helpers;

    #[test]
    fn permissions_reach_only_negotiated_members() {
        let (mut host, mut host_rx) = test_helpers::create_client_with_rx("host", "Host", true);
        let (legacy, mut legacy_rx) = test_helpers::create_client_with_rx("legacy", "Legacy", true);
        host.supports_room_permissions = true;
        let mut room = test_helpers::create_room("r1", "host");
        room.clients.push("legacy".into());
        room.permissions.seek = true;
        let clients = HashMap::from([("host".into(), host), ("legacy".into(), legacy)]);

        send_room_permissions(&room, &clients, None);

        let message = test_helpers::recv_msg(&mut host_rx).unwrap();
        assert_eq!(message.msg_type, ServerMessageType::RoomPermissions);
        assert_eq!(
            message.payload.unwrap(),
            serde_json::json!({"seek": true, "change_media": false, "edit_queue": false})
        );
        assert!(test_helpers::recv_msg(&mut legacy_rx).is_none());
    }

    #[test]
    fn targeted_permissions_reach_only_the_requested_member() {
        let (mut host, mut host_rx) = test_helpers::create_client_with_rx("host", "Host", true);
        let (mut guest, mut guest_rx) = test_helpers::create_client_with_rx("guest", "Guest", true);
        host.supports_room_permissions = true;
        guest.supports_room_permissions = true;
        let mut room = test_helpers::create_room("r1", "host");
        room.clients.push("guest".into());
        let clients = HashMap::from([("host".into(), host), ("guest".into(), guest)]);

        send_room_permissions(&room, &clients, Some("guest"));

        assert_eq!(
            test_helpers::recv_msg(&mut guest_rx).unwrap().msg_type,
            ServerMessageType::RoomPermissions
        );
        assert!(test_helpers::recv_msg(&mut host_rx).is_none());
    }
}

/// Builds a `participant_list`: members in join order, with the host flagged
/// and, for moderation-aware recipients, their client ids.
///
/// It is a message type of its own, rather than new fields on `room_state` or
/// `participants_update`, because clients validate those payloads strictly and
/// would drop them. A client that does not know `participant_list` ignores it
/// and keeps showing the participant count.
fn participant_list_message(
    room: &Room,
    clients: &HashMap<String, Client>,
    include_ids: bool,
) -> WsMessage {
    let participants: Vec<serde_json::Value> = room
        .clients
        .iter()
        .filter_map(|client_id| {
            clients.get(client_id).map(|client| {
                let mut participant = serde_json::json!({
                    "name": client.user_name,
                    "is_host": *client_id == room.host_id,
                });
                if include_ids {
                    participant["id"] = serde_json::json!(client_id);
                }
                participant
            })
        })
        .collect();
    WsMessage {
        msg_type: ServerMessageType::ParticipantList,
        room: Some(room.room_id.clone()),
        client: None,
        payload: Some(serde_json::json!({ "participants": participants })),
        ts: now_ms(),
        server_ts: Some(now_ms()),
    }
}

pub(crate) fn participant_list_notification(
    room: &Room,
    clients: &HashMap<String, Client>,
) -> ParticipantListNotification {
    let mut legacy_senders = Vec::new();
    let mut moderation_senders = Vec::new();
    for client in room.clients.iter().filter_map(|id| clients.get(id)) {
        if client.supports_room_moderation {
            moderation_senders.push(client.sender.clone());
        } else {
            legacy_senders.push(client.sender.clone());
        }
    }
    ParticipantListNotification {
        legacy_senders,
        moderation_senders,
        legacy_message: participant_list_message(room, clients, false),
        moderation_message: participant_list_message(room, clients, true),
    }
}

pub(crate) fn send_participant_list(notification: &ParticipantListNotification) {
    crate::messaging::send_to_senders(
        &notification.legacy_senders,
        &notification.legacy_message,
        "participant list",
    );
    crate::messaging::send_to_senders(
        &notification.moderation_senders,
        &notification.moderation_message,
        "participant list",
    );
}

pub(crate) fn send_room_participant_list(room: &Room, clients: &HashMap<String, Client>) {
    send_participant_list(&participant_list_notification(room, clients));
}

/// Builds the `participant_statuses` message: each member's last reported
/// status, or null, in the same order as `participant_list`. It is sent right
/// after every `participant_list` and whenever a status changes. Clients that
/// do not know it ignore it, as `participant_list` rejects unknown fields.
pub fn participant_statuses_message(room: &Room) -> WsMessage {
    let statuses: Vec<serde_json::Value> = room
        .clients
        .iter()
        .map(|client_id| {
            room.statuses
                .get(client_id)
                .map_or(serde_json::Value::Null, |status| serde_json::json!(status))
        })
        .collect();
    WsMessage {
        msg_type: ServerMessageType::ParticipantStatuses,
        room: Some(room.room_id.clone()),
        client: None,
        payload: Some(serde_json::json!({ "statuses": statuses })),
        ts: now_ms(),
        server_ts: Some(now_ms()),
    }
}

/// Builds the `participant_tracks` message: each member's last reported audio
/// and subtitle tracks, or null, in the same order as `participant_list`. It
/// is sent right after every `participant_statuses` and whenever a member's
/// tracks change. Clients that do not know it ignore it.
pub fn participant_tracks_message(room: &Room) -> WsMessage {
    let tracks: Vec<serde_json::Value> = room
        .clients
        .iter()
        .map(|client_id| {
            room.tracks
                .get(client_id)
                .cloned()
                .unwrap_or(serde_json::Value::Null)
        })
        .collect();
    WsMessage {
        msg_type: ServerMessageType::ParticipantTracks,
        room: Some(room.room_id.clone()),
        client: None,
        payload: Some(serde_json::json!({ "tracks": tracks })),
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

        let message = participant_list_message(&room, &clients, false);

        assert_eq!(message.msg_type, ServerMessageType::ParticipantList);
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

        let message = participant_list_message(&room, &clients, false);

        assert_eq!(
            message.payload.unwrap()["participants"],
            serde_json::json!([{ "name": "Franco", "is_host": true }])
        );
    }

    #[test]
    fn statuses_follow_the_list_order_with_null_when_unknown() {
        let mut room = test_helpers::create_room("room", "host");
        room.clients = vec!["host".to_string(), "ana".to_string(), "bruno".to_string()];
        room.statuses.insert("bruno".to_string(), "buffering");
        room.statuses.insert("host".to_string(), "playing");

        let message = participant_statuses_message(&room);

        assert_eq!(message.msg_type, ServerMessageType::ParticipantStatuses);
        assert_eq!(message.room.as_deref(), Some("room"));
        assert_eq!(
            message.payload.unwrap()["statuses"],
            serde_json::json!(["playing", null, "buffering"])
        );
    }

    #[test]
    fn ids_are_sent_only_to_clients_that_negotiated_moderation() {
        let (mut host, mut host_rx) = test_helpers::create_client_with_rx("u1", "Franco", true);
        let (guest, mut guest_rx) = test_helpers::create_client_with_rx("u2", "Ana", true);
        host.supports_room_moderation = true;
        let clients = HashMap::from([("host".to_string(), host), ("guest".to_string(), guest)]);
        let mut room = test_helpers::create_room("room", "host");
        room.clients.push("guest".to_string());

        send_room_participant_list(&room, &clients);

        assert_eq!(
            test_helpers::recv_msg(&mut host_rx)
                .unwrap()
                .payload
                .unwrap()["participants"],
            serde_json::json!([
                { "id": "host", "name": "Franco", "is_host": true },
                { "id": "guest", "name": "Ana", "is_host": false }
            ])
        );
        assert_eq!(
            test_helpers::recv_msg(&mut guest_rx)
                .unwrap()
                .payload
                .unwrap()["participants"],
            serde_json::json!([
                { "name": "Franco", "is_host": true },
                { "name": "Ana", "is_host": false }
            ])
        );
    }
    #[test]
    fn tracks_follow_the_list_order_with_null_when_unknown() {
        let mut room = test_helpers::create_room("room", "host");
        room.clients = vec!["host".to_string(), "ana".to_string()];
        let english = serde_json::json!({ "media_id": "0".repeat(32), "audio": { "title": "English" }, "subtitle": null });
        room.tracks.insert("ana".to_string(), english.clone());

        let message = participant_tracks_message(&room);

        assert_eq!(message.msg_type, ServerMessageType::ParticipantTracks);
        assert_eq!(message.room.as_deref(), Some("room"));
        assert_eq!(
            message.payload.unwrap()["tracks"],
            serde_json::json!([null, english])
        );
    }
}
