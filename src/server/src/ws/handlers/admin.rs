//! `admin_close_room`: a Jellyfin administrator closes a room from the plugin page.

use super::super::dispatch::{send_error, ErrorCode};
use crate::room::{close_room_as_admin, AdminCloseError};
use crate::types::{IncomingMessage, SharedState};
use log::info;

pub(in crate::ws) async fn handle_admin_close_room(
    client_id: &str,
    parsed: &IncomingMessage,
    state: &SharedState,
) {
    let Some(room_id) = parsed
        .payload
        .as_ref()
        .and_then(|payload| payload.get("room_id"))
        .and_then(|room_id| room_id.as_str())
    else {
        send_error(
            client_id,
            state,
            ErrorCode::RoomIdRequired,
            "Room ID is required",
        )
        .await;
        return;
    };
    match close_room_as_admin(room_id, state).await {
        Ok(()) => {
            let admin_user = state
                .read()
                .await
                .clients
                .get(client_id)
                .map(|client| client.user_id.clone())
                .unwrap_or_default();
            info!("Administrator closed room room_id={room_id} admin_user={admin_user}");
            crate::admin::broadcast_admin_rooms(state).await;
        }
        Err(AdminCloseError::NotFound) => {
            send_error(client_id, state, ErrorCode::RoomNotFound, "Room not found").await;
        }
        Err(AdminCloseError::Saving) => {
            send_error(
                client_id,
                state,
                ErrorCode::RoomSaveInProgress,
                "The room is being saved",
            )
            .await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers;
    use crate::types::{
        IncomingMessage, PlayState, SaveReservation, ServerMessageType, SharedState, WsMessage,
    };
    use std::collections::HashSet;
    use tokio::sync::mpsc;

    type Rx = mpsc::Receiver<Result<warp::ws::Message, warp::Error>>;

    fn close_message(payload: serde_json::Value) -> IncomingMessage {
        IncomingMessage {
            msg_type: crate::types::ClientMessageType::AdminCloseRoom,
            room: None,
            client: None,
            payload: Some(payload),
            ts: 0,
            server_ts: None,
        }
    }

    fn drain(rx: &mut Rx) -> Vec<WsMessage> {
        std::iter::from_fn(|| test_helpers::recv_msg(rx)).collect()
    }

    async fn state_with_room() -> (SharedState, Rx, Rx, Rx, Rx) {
        let state = test_helpers::create_state();
        let (mut host, host_rx) = test_helpers::create_client_with_rx("u-host", "Host", true);
        let (mut guest, guest_rx) = test_helpers::create_client_with_rx("u-guest", "Guest", true);
        let (mut first, first_rx) = test_helpers::create_client_with_rx("u-a1", "Admin", true);
        let (mut second, second_rx) = test_helpers::create_client_with_rx("u-a2", "Admin", true);
        host.room_id = Some("r1".to_string());
        guest.room_id = Some("r1".to_string());
        first.admin = true;
        second.admin = true;
        {
            let mut locked = state.write().await;
            locked.clients.insert("host".to_string(), host);
            locked.clients.insert("guest".to_string(), guest);
            locked.clients.insert("a1".to_string(), first);
            locked.clients.insert("a2".to_string(), second);
            let mut room = test_helpers::create_room("r1", "host");
            room.clients.push("guest".to_string());
            locked.rooms.insert("r1".to_string(), room);
        }
        (state, host_rx, guest_rx, first_rx, second_rx)
    }

    fn error_code(messages: &[WsMessage]) -> Option<String> {
        messages
            .iter()
            .find(|m| m.msg_type == ServerMessageType::Error)
            .map(|m| {
                m.payload.as_ref().unwrap()["code"]
                    .as_str()
                    .unwrap()
                    .to_string()
            })
    }

    #[tokio::test]
    async fn admin_close_room_closes_and_tells_members_why() {
        let (state, mut host_rx, mut guest_rx, mut first_rx, mut second_rx) =
            state_with_room().await;

        handle_admin_close_room(
            "a1",
            &close_message(serde_json::json!({ "room_id": "r1" })),
            &state,
        )
        .await;

        for rx in [&mut host_rx, &mut guest_rx] {
            let messages = drain(rx);
            let closed = messages
                .iter()
                .find(|m| m.msg_type == ServerMessageType::RoomClosed)
                .expect("members are told the room closed");
            assert_eq!(
                closed.payload.as_ref().unwrap()["reason"],
                "Server administrator closed the room"
            );
        }
        for rx in [&mut first_rx, &mut second_rx] {
            let messages = drain(rx);
            let rooms = messages
                .iter()
                .find(|m| m.msg_type == ServerMessageType::AdminRooms)
                .expect("every administrator gets the new rooms");
            assert_eq!(
                rooms.payload.as_ref().unwrap()["rooms"],
                serde_json::json!([])
            );
            assert!(messages
                .iter()
                .all(|m| m.msg_type != ServerMessageType::RoomList));
        }
        let locked = state.read().await;
        assert!(locked.rooms.is_empty());
        assert!(locked.clients["host"].room_id.is_none());
        assert!(locked.clients["guest"].room_id.is_none());
    }

    #[tokio::test]
    async fn admin_close_room_without_room_id_is_rejected() {
        let (state, _host, _guest, mut first_rx, _second) = state_with_room().await;

        handle_admin_close_room("a1", &close_message(serde_json::json!({})), &state).await;

        assert_eq!(
            error_code(&drain(&mut first_rx)).as_deref(),
            Some("ROOM_ID_REQUIRED")
        );
        assert!(state.read().await.rooms.contains_key("r1"));
    }

    #[tokio::test]
    async fn admin_close_room_of_a_missing_room_reports_room_not_found() {
        let (state, _host, _guest, mut first_rx, _second) = state_with_room().await;

        handle_admin_close_room(
            "a1",
            &close_message(serde_json::json!({ "room_id": "gone" })),
            &state,
        )
        .await;

        assert_eq!(
            error_code(&drain(&mut first_rx)).as_deref(),
            Some("ROOM_NOT_FOUND")
        );
    }

    #[tokio::test]
    async fn admin_close_room_while_saving_reports_save_in_progress() {
        let (state, _host, _guest, mut first_rx, _second) = state_with_room().await;
        state.write().await.rooms.get_mut("r1").unwrap().saving = Some(SaveReservation {
            generation: 1,
            captured_at_ms: 0,
            play_state: PlayState::Paused,
            pending_play: None,
            countdown: None,
            countdown_pending: false,
            deferred_disconnects: HashSet::new(),
        });

        handle_admin_close_room(
            "a1",
            &close_message(serde_json::json!({ "room_id": "r1" })),
            &state,
        )
        .await;

        assert_eq!(
            error_code(&drain(&mut first_rx)).as_deref(),
            Some("ROOM_SAVE_IN_PROGRESS")
        );
        assert!(state.read().await.rooms.contains_key("r1"));
    }
}
