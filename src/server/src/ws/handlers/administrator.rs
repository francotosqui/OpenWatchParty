use super::super::dispatch::{is_authenticated, send_error, ErrorCode};
use crate::types::{IncomingMessage, ServerState, SharedState};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SetAdministratorPayload {
    participant_id: Option<String>,
    user_id: Option<String>,
    enabled: bool,
}

pub(in crate::ws) async fn handle_set_room_administrator(
    client_id: &str,
    parsed: &IncomingMessage,
    state: &SharedState,
) {
    if !is_authenticated(client_id, state).await {
        send_error(
            client_id,
            state,
            ErrorCode::AuthenticationRequired,
            "Authentication required",
        )
        .await;
        return;
    }
    let Some(payload) = parsed
        .payload
        .clone()
        .and_then(|value| serde_json::from_value::<SetAdministratorPayload>(value).ok())
        .filter(|payload| {
            (payload.participant_id.is_some() != payload.user_id.is_some())
                && (!payload.enabled || payload.participant_id.is_some())
                && payload
                    .participant_id
                    .as_ref()
                    .is_none_or(|id| !id.is_empty())
                && payload.user_id.as_ref().is_none_or(|id| !id.is_empty())
        })
    else {
        send_error(
            client_id,
            state,
            ErrorCode::InvalidAdministratorPayload,
            "Invalid administrator payload",
        )
        .await;
        return;
    };
    let error = {
        let mut locked = state.write().await;
        let ServerState { clients, rooms, .. } = &mut *locked;
        let room_id = clients
            .get(client_id)
            .and_then(|client| client.room_id.as_ref());
        match room_id.and_then(|id| rooms.get_mut(id)) {
            None => Some((ErrorCode::NotInRoom, "Client is not in a room")),
            Some(room)
                if room.host_id != client_id
                    || !clients
                        .get(client_id)
                        .is_some_and(|client| client.supports_room_administrator) =>
            {
                Some((
                    ErrorCode::HostPermissionRequired,
                    "Only Owner can change the administrator",
                ))
            }
            Some(room) => {
                if let Some(user_id) = payload.user_id.as_deref() {
                    if room.administrator_user_id.as_deref() != Some(user_id) {
                        Some((
                            ErrorCode::InvalidModerationTarget,
                            "Account is not the administrator",
                        ))
                    } else {
                        room.administrator_user_id = None;
                        crate::room::send_room_administrator(room, clients, None);
                        None
                    }
                } else {
                    let participant_id = payload
                        .participant_id
                        .as_deref()
                        .expect("validated participant id");
                    let target = clients.get(participant_id).filter(|client| {
                        room.clients.iter().any(|id| id == participant_id)
                            && client.room_id.as_deref() == Some(room.room_id.as_str())
                    });
                    match target {
                        None => Some((
                            ErrorCode::ParticipantNotFound,
                            "Participant is no longer in this room",
                        )),
                        Some(target)
                            if participant_id == room.host_id
                                || clients.get(&room.host_id).is_some_and(|owner| {
                                    !owner.user_id.is_empty() && owner.user_id == target.user_id
                                }) =>
                        {
                            Some((
                                ErrorCode::InvalidModerationTarget,
                                "Owner cannot become administrator",
                            ))
                        }
                        Some(target)
                            if !target.supports_room_administrator
                                || !target.authenticated
                                || target.user_id.is_empty() =>
                        {
                            Some((
                                ErrorCode::InvalidModerationTarget,
                                "Participant does not support this role",
                            ))
                        }
                        Some(target)
                            if payload.enabled
                                && room
                                    .administrator_user_id
                                    .as_deref()
                                    .is_some_and(|id| id != target.user_id) =>
                        {
                            Some((
                                ErrorCode::AdministratorAlreadyAssigned,
                                "This room already has an administrator",
                            ))
                        }
                        Some(target)
                            if !payload.enabled
                                && room.administrator_user_id.as_deref()
                                    != Some(target.user_id.as_str()) =>
                        {
                            Some((
                                ErrorCode::InvalidModerationTarget,
                                "Participant is not the administrator",
                            ))
                        }
                        Some(target) => {
                            room.administrator_user_id =
                                payload.enabled.then(|| target.user_id.clone());
                            crate::room::send_room_administrator(room, clients, None);
                            None
                        }
                    }
                }
            }
        }
    };
    if let Some((code, message)) = error {
        send_error(client_id, state, code, message).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers;
    use crate::types::{ClientMessageType, IncomingMessage};

    fn message(participant_id: &str, enabled: bool) -> IncomingMessage {
        IncomingMessage {
            msg_type: ClientMessageType::SetRoomAdministrator,
            room: Some("room".into()),
            client: None,
            payload: Some(
                serde_json::json!({"participant_id": participant_id, "enabled": enabled}),
            ),
            ts: 0,
            server_ts: None,
        }
    }

    #[tokio::test]
    async fn owner_can_assign_one_administrator_and_must_revoke_before_replacing() {
        let state = test_helpers::create_state();
        let mut locked = state.write().await;
        let mut room = test_helpers::create_room("room", "owner");
        room.clients.extend(["ana".into(), "bruno".into()]);
        for id in ["owner", "ana", "bruno"] {
            let (mut client, _) = test_helpers::create_client_with_rx(id, id, true);
            client.room_id = Some("room".into());
            client.supports_room_administrator = true;
            locked.clients.insert(id.into(), client);
        }
        locked.rooms.insert("room".into(), room);
        drop(locked);

        handle_set_room_administrator("owner", &message("ana", true), &state).await;
        assert_eq!(
            state.read().await.rooms["room"]
                .administrator_user_id
                .as_deref(),
            Some("ana")
        );
        handle_set_room_administrator("owner", &message("bruno", true), &state).await;
        assert_eq!(
            state.read().await.rooms["room"]
                .administrator_user_id
                .as_deref(),
            Some("ana")
        );
        handle_set_room_administrator("ana", &message("ana", false), &state).await;
        assert_eq!(
            state.read().await.rooms["room"]
                .administrator_user_id
                .as_deref(),
            Some("ana")
        );
        handle_set_room_administrator("owner", &message("ana", false), &state).await;
        assert_eq!(state.read().await.rooms["room"].administrator_user_id, None);
        handle_set_room_administrator("owner", &message("bruno", true), &state).await;
        assert_eq!(
            state.read().await.rooms["room"]
                .administrator_user_id
                .as_deref(),
            Some("bruno")
        );
    }

    #[tokio::test]
    async fn invalid_targets_and_legacy_clients_cannot_gain_the_role() {
        let state = test_helpers::create_state();
        let mut locked = state.write().await;
        let mut room = test_helpers::create_room("room", "owner");
        room.clients
            .extend(["owner-tab".into(), "legacy".into(), "empty".into()]);
        for (id, user_id, supports) in [
            ("owner", "owner-account", true),
            ("owner-tab", "owner-account", true),
            ("legacy", "legacy-account", false),
            ("empty", "", true),
        ] {
            let (mut client, _) = test_helpers::create_client_with_rx(id, user_id, true);
            client.user_id = user_id.into();
            client.room_id = Some("room".into());
            client.supports_room_administrator = supports;
            locked.clients.insert(id.into(), client);
        }
        locked.rooms.insert("room".into(), room);
        drop(locked);

        for target in ["owner-tab", "legacy", "empty", "gone"] {
            handle_set_room_administrator("owner", &message(target, true), &state).await;
            assert_eq!(state.read().await.rooms["room"].administrator_user_id, None);
        }
        handle_set_room_administrator("legacy", &message("owner-tab", true), &state).await;
        assert_eq!(state.read().await.rooms["room"].administrator_user_id, None);
    }

    #[tokio::test]
    async fn simultaneous_appointments_leave_exactly_one_administrator() {
        let state = test_helpers::create_state();
        let mut locked = state.write().await;
        let mut room = test_helpers::create_room("room", "owner");
        room.clients.extend(["ana".into(), "bruno".into()]);
        for id in ["owner", "ana", "bruno"] {
            let (mut client, _) = test_helpers::create_client_with_rx(id, id, true);
            client.room_id = Some("room".into());
            client.supports_room_administrator = true;
            locked.clients.insert(id.into(), client);
        }
        locked.rooms.insert("room".into(), room);
        drop(locked);

        let ana = message("ana", true);
        let bruno = message("bruno", true);
        tokio::join!(
            handle_set_room_administrator("owner", &ana, &state),
            handle_set_room_administrator("owner", &bruno, &state),
        );
        assert!(matches!(
            state.read().await.rooms["room"]
                .administrator_user_id
                .as_deref(),
            Some("ana" | "bruno")
        ));
    }

    #[tokio::test]
    async fn owner_can_revoke_disconnected_administrator_by_account() {
        let state = test_helpers::create_state();
        let (mut owner, _) = test_helpers::create_client_with_rx("owner", "Owner", true);
        owner.room_id = Some("room".into());
        owner.supports_room_administrator = true;
        let mut room = test_helpers::create_room("room", "owner");
        room.administrator_user_id = Some("ana".into());
        {
            let mut locked = state.write().await;
            locked.clients.insert("owner".into(), owner);
            locked.rooms.insert("room".into(), room);
        }
        let revoke = IncomingMessage {
            payload: Some(serde_json::json!({"user_id": "ana", "enabled": false})),
            ..message("unused", false)
        };
        let stale = IncomingMessage {
            payload: Some(serde_json::json!({"user_id": "other", "enabled": false})),
            ..message("unused", false)
        };
        handle_set_room_administrator("owner", &stale, &state).await;
        assert_eq!(
            state.read().await.rooms["room"]
                .administrator_user_id
                .as_deref(),
            Some("ana")
        );
        handle_set_room_administrator("owner", &revoke, &state).await;
        assert_eq!(state.read().await.rooms["room"].administrator_user_id, None);
    }
}
