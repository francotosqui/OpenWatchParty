use super::super::constants::{CHAT_HISTORY_LIMIT, MAX_CHAT_MESSAGE_LENGTH};
use super::super::dispatch::{send_error, ErrorCode};
use crate::messaging::ClientSender;
use crate::types::{ChatEntry, IncomingMessage, Room, ServerMessageType, SharedState, WsMessage};
use crate::utils::now_ms;

fn validate_chat(text: &str) -> Result<(), &'static str> {
    if text.is_empty() {
        return Err("Chat message cannot be empty");
    }
    // Counted in characters, matching the client-side validator and the error
    // message. Counting UTF-8 bytes rejected ordinary CJK or emoji messages.
    if text.chars().count() > MAX_CHAT_MESSAGE_LENGTH {
        return Err("Chat message too long");
    }
    Ok(())
}

/// One chat message per payload variant: avatar-aware members also get the
/// sender's Jellyfin user id.
type BroadcastData = Vec<(Vec<ClientSender>, WsMessage)>;

/// Keeps the message for members who join later, the oldest going first.
fn remember(room: &mut Room, message: &WsMessage, user_id: &str, username: &str, text: &str) {
    room.chat_history.push_back(ChatEntry {
        client: message.client.clone().unwrap_or_default(),
        user_id: user_id.to_string(),
        username: username.to_string(),
        text: text.to_string(),
        server_ts: message.server_ts.unwrap_or_else(now_ms),
    });
    while room.chat_history.len() > CHAT_HISTORY_LIMIT {
        room.chat_history.pop_front();
    }
}

/// The room's history, to a member that negotiated `chat_history` and just
/// joined. Nothing when it is empty.
pub(in crate::ws) fn send_chat_history(
    room: &Room,
    clients: &std::collections::HashMap<String, crate::types::Client>,
    client_id: &str,
) {
    let Some(client) = clients
        .get(client_id)
        .filter(|client| client.supports_chat_history)
    else {
        return;
    };
    if room.chat_history.is_empty() {
        return;
    }
    // `own`: sent by this member's user, from this or an earlier connection.
    let messages: Vec<_> = room
        .chat_history
        .iter()
        .map(|entry| {
            let mut message = serde_json::json!({
                "client": entry.client,
                "username": entry.username,
                "text": entry.text,
                "server_ts": entry.server_ts,
                "own": !entry.user_id.is_empty() && entry.user_id == client.user_id,
            });
            if client.supports_user_avatars && !entry.user_id.is_empty() {
                message["user_id"] = serde_json::json!(entry.user_id);
            }
            message
        })
        .collect();
    let message = WsMessage {
        msg_type: ServerMessageType::ChatHistory,
        room: Some(room.room_id.clone()),
        client: None,
        payload: Some(serde_json::json!({ "messages": messages })),
        ts: now_ms(),
        server_ts: Some(now_ms()),
    };
    crate::messaging::send_message(Some(client.sender.clone()), &message, Some(client_id));
}

fn collect_chat_senders(
    room_id: &str,
    client_id: &str,
    username: &str,
    chat_text: &str,
    rooms: &std::collections::HashMap<String, crate::types::Room>,
    clients: &std::collections::HashMap<String, crate::types::Client>,
) -> Option<BroadcastData> {
    let room = rooms.get(room_id)?;
    if !room.clients.contains(&client_id.to_string()) {
        return None;
    }
    let user_id = clients
        .get(client_id)
        .map(|c| c.user_id.as_str())
        .unwrap_or_default();
    let message = |with_user_id: bool| {
        let mut payload = serde_json::json!({ "username": username, "text": chat_text });
        if with_user_id && !user_id.is_empty() {
            payload["user_id"] = serde_json::json!(user_id);
        }
        WsMessage {
            msg_type: ServerMessageType::ChatMessage,
            room: Some(room_id.to_string()),
            client: Some(client_id.to_string()),
            payload: Some(payload),
            ts: now_ms(),
            server_ts: Some(now_ms()),
        }
    };
    let (avatars, legacy): (Vec<_>, Vec<_>) = room
        .clients
        .iter()
        .filter_map(|id| clients.get(id))
        .partition(|c| c.supports_user_avatars);
    let senders = |group: Vec<&crate::types::Client>| -> Vec<ClientSender> {
        group.into_iter().map(|c| c.sender.clone()).collect()
    };
    Some(vec![
        (senders(legacy), message(false)),
        (senders(avatars), message(true)),
    ])
}

pub(in crate::ws) async fn handle_chat_message(
    client_id: &str,
    parsed: &IncomingMessage,
    state: &SharedState,
) {
    let Some(ref room_id) = parsed.room else {
        send_error(
            client_id,
            state,
            ErrorCode::RoomIdRequired,
            "Room ID required for chat",
        )
        .await;
        return;
    };

    let Some(chat_text) = parsed
        .payload
        .as_ref()
        .and_then(|p| p.get("text"))
        .and_then(|v| v.as_str())
    else {
        send_error(
            client_id,
            state,
            ErrorCode::InvalidChatPayload,
            "Chat payload must contain text",
        )
        .await;
        return;
    };

    if let Err(msg) = validate_chat(chat_text) {
        let (code, detail) = if chat_text.chars().count() > MAX_CHAT_MESSAGE_LENGTH {
            (
                ErrorCode::ChatMessageTooLong,
                format!("{msg} (max {MAX_CHAT_MESSAGE_LENGTH} characters)"),
            )
        } else {
            (ErrorCode::ChatMessageEmpty, msg.to_string())
        };
        send_error(client_id, state, code, &detail).await;
        return;
    }

    let result = {
        let mut locked = state.write().await;
        if let Some(room) = locked.rooms.get(room_id) {
            if room.clients.iter().any(|id| id == client_id) {
                let username = locked
                    .clients
                    .get(client_id)
                    .map(|c| c.user_name.clone())
                    .unwrap_or_else(|| "Anonymous".to_string());
                let user_id = locked
                    .clients
                    .get(client_id)
                    .map(|c| c.user_id.clone())
                    .unwrap_or_default();
                let delivery = collect_chat_senders(
                    room_id,
                    client_id,
                    &username,
                    chat_text,
                    &locked.rooms,
                    &locked.clients,
                )
                .expect("room membership checked");
                for (senders, message) in &delivery {
                    crate::messaging::send_to_senders(senders, message, "chat message");
                }
                let room = locked.rooms.get_mut(room_id).expect("room checked");
                remember(room, &delivery[0].1, &user_id, &username, chat_text);
                Ok(())
            } else {
                Err((
                    ErrorCode::NotRoomMember,
                    "Client is not a member of this room",
                ))
            }
        } else {
            Err((ErrorCode::RoomNotFound, "Room not found"))
        }
    };
    match result {
        Ok(()) => {}
        Err((code, message)) => send_error(client_id, state, code, message).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers;

    fn chat_message(room: Option<&str>, payload: Option<serde_json::Value>) -> IncomingMessage {
        IncomingMessage {
            msg_type: crate::types::ClientMessageType::ChatMessage,
            room: room.map(str::to_string),
            client: None,
            payload,
            ts: 0,
            server_ts: None,
        }
    }

    fn assert_error_code(message: WsMessage, code: &str) {
        assert_eq!(message.msg_type, ServerMessageType::Error);
        assert_eq!(message.payload.unwrap()["code"], code);
    }

    #[tokio::test]
    async fn a_room_keeps_its_last_messages_for_later_members() {
        let state = test_helpers::create_state();
        let (mut host, _host_rx) = test_helpers::create_client_with_rx("u1", "Franco", true);
        host.room_id = Some("room".to_string());
        let (outsider, _outsider_rx) = test_helpers::create_client_with_rx("u2", "Eve", true);
        {
            let mut locked = state.write().await;
            locked.clients.insert("host".to_string(), host);
            locked.clients.insert("outsider".to_string(), outsider);
            locked.rooms.insert(
                "room".to_string(),
                test_helpers::create_room("room", "host"),
            );
        }
        for i in 0..CHAT_HISTORY_LIMIT + 2 {
            let text = format!("message {i}");
            handle_chat_message(
                "host",
                &chat_message(Some("room"), Some(serde_json::json!({ "text": text }))),
                &state,
            )
            .await;
        }
        handle_chat_message(
            "outsider",
            &chat_message(
                Some("room"),
                Some(serde_json::json!({ "text": "not here" })),
            ),
            &state,
        )
        .await;

        let locked = state.read().await;
        let history = &locked.rooms["room"].chat_history;
        assert_eq!(history.len(), CHAT_HISTORY_LIMIT);
        // The oldest go first.
        assert_eq!(history.front().unwrap().text, "message 2");
        let last = history.back().unwrap();
        assert_eq!(last.text, format!("message {}", CHAT_HISTORY_LIMIT + 1));
        assert_eq!(last.username, "Franco");
        assert_eq!(last.user_id, "u1");
        assert_eq!(last.client, "host");
        assert!(last.server_ts > 0);
    }

    async fn avatar_room(
        sender_user_id: &str,
    ) -> (
        SharedState,
        tokio::sync::mpsc::Receiver<Result<warp::ws::Message, warp::Error>>,
        tokio::sync::mpsc::Receiver<Result<warp::ws::Message, warp::Error>>,
    ) {
        let state = test_helpers::create_state();
        let (mut host, host_rx) =
            test_helpers::create_client_with_rx(sender_user_id, "Franco", true);
        host.room_id = Some("room".to_string());
        host.supports_user_avatars = true;
        let (mut guest, guest_rx) = test_helpers::create_client_with_rx("u2", "Ana", true);
        guest.room_id = Some("room".to_string());
        let mut room = test_helpers::create_room("room", "host");
        room.clients.push("guest".to_string());
        let mut locked = state.write().await;
        locked.clients.insert("host".to_string(), host);
        locked.clients.insert("guest".to_string(), guest);
        locked.rooms.insert("room".to_string(), room);
        drop(locked);
        (state, host_rx, guest_rx)
    }

    #[tokio::test]
    async fn chat_message_includes_user_id_only_for_avatar_clients() {
        let (state, mut host_rx, mut guest_rx) = avatar_room("u1").await;
        handle_chat_message(
            "host",
            &chat_message(Some("room"), Some(serde_json::json!({ "text": "hola" }))),
            &state,
        )
        .await;
        let avatar = test_helpers::recv_msg(&mut host_rx).unwrap();
        assert_eq!(avatar.msg_type, ServerMessageType::ChatMessage);
        assert_eq!(
            avatar.payload.unwrap(),
            serde_json::json!({ "username": "Franco", "text": "hola", "user_id": "u1" })
        );
        let legacy = test_helpers::recv_msg(&mut guest_rx).unwrap();
        assert_eq!(
            legacy.payload.unwrap(),
            serde_json::json!({ "username": "Franco", "text": "hola" })
        );
    }

    #[tokio::test]
    async fn empty_user_id_is_omitted() {
        let (state, mut host_rx, _guest_rx) = avatar_room("").await;
        handle_chat_message(
            "host",
            &chat_message(Some("room"), Some(serde_json::json!({ "text": "hola" }))),
            &state,
        )
        .await;
        let payload = test_helpers::recv_msg(&mut host_rx)
            .unwrap()
            .payload
            .unwrap();
        assert!(payload.get("user_id").is_none());
    }

    #[tokio::test]
    async fn chat_history_includes_user_id_only_for_avatar_clients() {
        let (state, mut host_rx, mut guest_rx) = avatar_room("u1").await;
        handle_chat_message(
            "host",
            &chat_message(Some("room"), Some(serde_json::json!({ "text": "hola" }))),
            &state,
        )
        .await;
        test_helpers::recv_msg(&mut host_rx).unwrap();
        test_helpers::recv_msg(&mut guest_rx).unwrap();
        let mut locked = state.write().await;
        for id in ["host", "guest"] {
            locked.clients.get_mut(id).unwrap().supports_chat_history = true;
        }
        let room = locked.rooms["room"].clone();
        send_chat_history(&room, &locked.clients, "host");
        send_chat_history(&room, &locked.clients, "guest");
        let avatar = test_helpers::recv_msg(&mut host_rx)
            .unwrap()
            .payload
            .unwrap();
        assert_eq!(avatar["messages"][0]["user_id"], "u1");
        let legacy = test_helpers::recv_msg(&mut guest_rx)
            .unwrap()
            .payload
            .unwrap();
        assert!(legacy["messages"][0].get("user_id").is_none());
    }

    #[test]
    fn validate_chat_valid() {
        assert!(validate_chat("Hello world").is_ok());
    }

    #[test]
    fn validate_chat_empty() {
        assert!(validate_chat("").is_err());
    }

    #[test]
    fn validate_chat_too_long() {
        let long = "a".repeat(MAX_CHAT_MESSAGE_LENGTH + 1);
        assert!(validate_chat(&long).is_err());
    }

    #[test]
    fn validate_chat_at_limit() {
        let exact = "a".repeat(MAX_CHAT_MESSAGE_LENGTH);
        assert!(validate_chat(&exact).is_ok());
    }

    #[test]
    fn validate_chat_counts_characters_not_bytes() {
        let multibyte = "é".repeat(MAX_CHAT_MESSAGE_LENGTH);
        assert!(
            multibyte.len() > MAX_CHAT_MESSAGE_LENGTH,
            "the test must exercise a multi-byte payload"
        );
        assert!(validate_chat(&multibyte).is_ok());

        let multibyte_too_long = "é".repeat(MAX_CHAT_MESSAGE_LENGTH + 1);
        assert!(validate_chat(&multibyte_too_long).is_err());

        let emoji = "🎉".repeat(MAX_CHAT_MESSAGE_LENGTH);
        assert!(validate_chat(&emoji).is_ok());
    }

    #[tokio::test]
    async fn chat_validation_errors_have_stable_codes() {
        let state = test_helpers::create_state();
        let (client, mut rx) = test_helpers::create_client_with_rx("client", "Client", true);
        state
            .write()
            .await
            .clients
            .insert("client".to_string(), client);

        handle_chat_message("client", &chat_message(None, None), &state).await;
        assert_error_code(test_helpers::recv_msg(&mut rx).unwrap(), "ROOM_ID_REQUIRED");

        handle_chat_message("client", &chat_message(Some("room"), None), &state).await;
        assert_error_code(
            test_helpers::recv_msg(&mut rx).unwrap(),
            "INVALID_CHAT_PAYLOAD",
        );

        handle_chat_message(
            "client",
            &chat_message(Some("room"), Some(serde_json::json!({ "text": "" }))),
            &state,
        )
        .await;
        assert_error_code(
            test_helpers::recv_msg(&mut rx).unwrap(),
            "CHAT_MESSAGE_EMPTY",
        );

        handle_chat_message(
            "client",
            &chat_message(
                Some("room"),
                Some(serde_json::json!({
                    "text": "a".repeat(MAX_CHAT_MESSAGE_LENGTH + 1)
                })),
            ),
            &state,
        )
        .await;
        assert_error_code(
            test_helpers::recv_msg(&mut rx).unwrap(),
            "CHAT_MESSAGE_TOO_LONG",
        );
    }

    #[tokio::test]
    async fn chat_rejects_missing_room_and_non_member() {
        let state = test_helpers::create_state();
        let (client, mut rx) = test_helpers::create_client_with_rx("client", "Client", true);
        state
            .write()
            .await
            .clients
            .insert("client".to_string(), client);
        let message = chat_message(Some("room"), Some(serde_json::json!({ "text": "hello" })));

        handle_chat_message("client", &message, &state).await;
        assert_error_code(test_helpers::recv_msg(&mut rx).unwrap(), "ROOM_NOT_FOUND");

        state.write().await.rooms.insert(
            "room".to_string(),
            test_helpers::create_room("room", "host"),
        );
        handle_chat_message("client", &message, &state).await;
        assert_error_code(test_helpers::recv_msg(&mut rx).unwrap(), "NOT_ROOM_MEMBER");
    }
}
