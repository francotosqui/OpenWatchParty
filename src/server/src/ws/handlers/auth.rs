use super::super::constants::{PROTOCOL_VERSION, ROOM_DASHBOARD_FEATURE};
use super::super::dispatch::{close_with_policy, send_error, ErrorCode};
use super::super::validation::sanitize_name;
use crate::auth::JwtConfig;
use crate::messaging::{send_message, send_room_list};
use crate::types::{IncomingMessage, ServerMessageType, SharedState, WsMessage};
use crate::utils::now_ms;
use log::{info, warn};
use std::sync::Arc;

const HOST_TRANSFER_FEATURE: &str = "host_transfer";
const PARTICIPANT_STATUS_FEATURE: &str = "participant_status";
const PARTICIPANT_TRACKS_FEATURE: &str = "participant_tracks";
const SHARED_PLAYBACK_FEATURE: &str = "shared_playback_control";
const ROOM_MODERATION_FEATURE: &str = "room_moderation";
const PERSISTENT_ROOMS_FEATURE: &str = "persistent_rooms";
const ROOM_ADMINISTRATOR_FEATURE: &str = "room_administrator";
const ROOM_PERMISSIONS_FEATURE: &str = "room_permissions";
const MEDIA_QUEUE_FEATURE: &str = "media_queue";
const ROOM_ACCESS_FEATURE: &str = "room_access";
const QUEUE_SUGGESTIONS_FEATURE: &str = "queue_suggestions";
const START_WHEN_READY_FEATURE: &str = "start_when_ready";
const CHAT_HISTORY_FEATURE: &str = "chat_history";
const CHAT_TYPING_FEATURE: &str = "chat_typing";
const USER_AVATARS_FEATURE: &str = "user_avatars";

async fn refresh_room_capabilities(client_id: &str, state: &SharedState) {
    let state = state.read().await;
    if let Some(room) = state
        .clients
        .get(client_id)
        .and_then(|client| client.room_id.as_ref())
        .and_then(|id| state.rooms.get(id))
    {
        crate::room::send_room_capabilities(room, &state.clients);
        crate::room::send_room_permissions(room, &state.clients, Some(client_id));
        crate::room::send_room_administrator(room, &state.clients, Some(client_id));
    }
}

/// Reads the protocol version declared in the auth payload.
///
/// `Ok(None)` means the field was absent: the client is treated as version 1 so
/// pre-negotiation clients keep working. `Ok(Some(version))` is a declared
/// version and `Err(())` a present but malformed value.
fn declared_protocol_version(payload: Option<&serde_json::Value>) -> Result<Option<u64>, ()> {
    match payload.and_then(|value| value.get("protocol_version")) {
        None => Ok(None),
        Some(version) => version.as_u64().map(Some).ok_or(()),
    }
}

/// Returns `None` when the field was absent and the supported subset otherwise.
fn declared_features(payload: Option<&serde_json::Value>) -> Option<Vec<String>> {
    let features = payload?.get("features")?;
    let declared: Vec<&str> = features
        .as_array()
        .map(|features| {
            features
                .iter()
                .filter_map(|feature| feature.as_str())
                .collect()
        })
        .unwrap_or_default();
    let mut supported = Vec::new();
    if declared.contains(&HOST_TRANSFER_FEATURE) {
        supported.push(HOST_TRANSFER_FEATURE.to_string());
    }
    if declared.contains(&PARTICIPANT_STATUS_FEATURE) {
        supported.push(PARTICIPANT_STATUS_FEATURE.to_string());
    }
    if declared.contains(&PARTICIPANT_TRACKS_FEATURE) {
        supported.push(PARTICIPANT_TRACKS_FEATURE.to_string());
    }
    if declared.contains(&SHARED_PLAYBACK_FEATURE) {
        supported.push(SHARED_PLAYBACK_FEATURE.to_string());
    }
    if declared.contains(&ROOM_MODERATION_FEATURE) {
        supported.push(ROOM_MODERATION_FEATURE.to_string());
    }
    if declared.contains(&ROOM_ADMINISTRATOR_FEATURE) {
        supported.push(ROOM_ADMINISTRATOR_FEATURE.to_string());
    }
    if declared.contains(&ROOM_PERMISSIONS_FEATURE) {
        supported.push(ROOM_PERMISSIONS_FEATURE.to_string());
    }
    if declared.contains(&MEDIA_QUEUE_FEATURE) {
        supported.push(MEDIA_QUEUE_FEATURE.to_string());
    }
    if declared.contains(&QUEUE_SUGGESTIONS_FEATURE) {
        supported.push(QUEUE_SUGGESTIONS_FEATURE.to_string());
    }
    if declared.contains(&START_WHEN_READY_FEATURE) {
        supported.push(START_WHEN_READY_FEATURE.to_string());
    }
    if declared.contains(&CHAT_HISTORY_FEATURE) {
        supported.push(CHAT_HISTORY_FEATURE.to_string());
    }
    if declared.contains(&CHAT_TYPING_FEATURE) {
        supported.push(CHAT_TYPING_FEATURE.to_string());
    }
    if declared.contains(&USER_AVATARS_FEATURE) {
        supported.push(USER_AVATARS_FEATURE.to_string());
    }
    if declared.contains(&ROOM_ACCESS_FEATURE) {
        supported.push(ROOM_ACCESS_FEATURE.to_string());
    }
    if declared.contains(&PERSISTENT_ROOMS_FEATURE) {
        supported.push(PERSISTENT_ROOMS_FEATURE.to_string());
    }
    Some(supported)
}

fn auth_success_message(
    client_id: &str,
    user_name: &str,
    protocol_version: Option<u64>,
    features: Option<&[String]>,
) -> WsMessage {
    let mut payload = serde_json::json!({ "user_name": user_name });
    if let Some(protocol_version) = protocol_version {
        payload["protocol_version"] = serde_json::json!(protocol_version);
    }
    if let Some(features) = features {
        payload["features"] = serde_json::json!(features);
    }
    WsMessage {
        msg_type: ServerMessageType::AuthSuccess,
        room: None,
        client: Some(client_id.to_string()),
        payload: Some(payload),
        ts: now_ms(),
        server_ts: Some(now_ms()),
    }
}

async fn reject_unsupported_protocol_version(client_id: &str, state: &SharedState, message: &str) {
    send_error(
        client_id,
        state,
        ErrorCode::ProtocolVersionUnsupported,
        message,
    )
    .await;
    close_with_policy(client_id, state, "Unsupported protocol version").await;
}

async fn handle_jwt_auth(
    client_id: &str,
    token: &str,
    state: &SharedState,
    jwt_config: &Arc<JwtConfig>,
    protocol_version: Option<u64>,
    features: Option<&[String]>,
) -> bool {
    match jwt_config.validate_token(token) {
        Ok(claims) => {
            let Some(user_name) = sanitize_name(&claims.name) else {
                warn!("Auth failed, JWT name is empty after sanitization client_id={client_id}");
                return false;
            };
            let sender = {
                let mut state = state.write().await;
                if state
                    .clients
                    .get(client_id)
                    .is_some_and(|client| client.admin)
                {
                    warn!("Session token on an administrator connection client_id={client_id}");
                    return false;
                }
                let sender = state.clients.get(client_id).map(|c| c.sender.clone());
                if let Some(client) = state.clients.get_mut(client_id) {
                    client.authenticated = true;
                    client.user_id = claims.sub;
                    client.user_name = user_name.clone();
                    client.session_expires_at = jwt_config.enabled.then_some(claims.exp as u64);
                    client.authentication_version = client.authentication_version.wrapping_add(1);
                    client.supports_host_transfer = features.is_some_and(|features| {
                        features.iter().any(|f| f == HOST_TRANSFER_FEATURE)
                    });
                    client.supports_shared_playback_control = features.is_some_and(|features| {
                        features.iter().any(|f| f == SHARED_PLAYBACK_FEATURE)
                    });
                    client.supports_room_moderation = features.is_some_and(|features| {
                        features.iter().any(|f| f == ROOM_MODERATION_FEATURE)
                    });
                    client.supports_persistent_rooms =
                        features.is_some_and(|f| f.iter().any(|v| v == PERSISTENT_ROOMS_FEATURE));
                    client.supports_room_administrator = features.is_some_and(|features| {
                        features.iter().any(|f| f == ROOM_ADMINISTRATOR_FEATURE)
                    });
                    client.supports_room_access = features
                        .is_some_and(|features| features.iter().any(|f| f == ROOM_ACCESS_FEATURE));
                    client.supports_room_permissions = features.is_some_and(|features| {
                        features.iter().any(|f| f == ROOM_PERMISSIONS_FEATURE)
                    });
                    client.supports_media_queue = features
                        .is_some_and(|features| features.iter().any(|f| f == MEDIA_QUEUE_FEATURE));
                    client.supports_queue_suggestions = features.is_some_and(|features| {
                        features.iter().any(|f| f == QUEUE_SUGGESTIONS_FEATURE)
                    });
                    client.supports_start_when_ready = features.is_some_and(|features| {
                        features.iter().any(|f| f == START_WHEN_READY_FEATURE)
                    });
                    client.supports_chat_history = features
                        .is_some_and(|features| features.iter().any(|f| f == CHAT_HISTORY_FEATURE));
                    client.supports_chat_typing = features
                        .is_some_and(|features| features.iter().any(|f| f == CHAT_TYPING_FEATURE));
                    client.supports_user_avatars = features
                        .is_some_and(|features| features.iter().any(|f| f == USER_AVATARS_FEATURE));
                    info!("Client authenticated client_id={client_id} user={user_name:?}");
                }
                sender
            };
            send_message(
                sender,
                &auth_success_message(client_id, &user_name, protocol_version, features),
                Some(client_id),
            );
            send_room_list(client_id, state).await;
            refresh_room_capabilities(client_id, state).await;
            true
        }
        Err(e) => {
            warn!(
                "Auth failed client_id={client_id} error={:?}",
                e.to_string()
            );
            false
        }
    }
}

/// Authenticates the plugin page of a Jellyfin administrator. Such a
/// connection never joins a room: it gets the open rooms instead of
/// `room_list`, and a connection never switches between the two kinds.
async fn handle_admin_auth(
    client_id: &str,
    token: &str,
    payload: &serde_json::Value,
    state: &SharedState,
    jwt_config: &Arc<JwtConfig>,
    protocol_version: Option<u64>,
) -> bool {
    let Ok(claims) = jwt_config.validate_admin_token(token) else {
        return false;
    };
    let Some(user_name) = sanitize_name(&claims.name) else {
        return false;
    };
    let declares_dashboard = payload
        .get("features")
        .and_then(|features| features.as_array())
        .is_some_and(|features| {
            features
                .iter()
                .any(|feature| feature.as_str() == Some(ROOM_DASHBOARD_FEATURE))
        });
    let features = declares_dashboard.then(|| vec![ROOM_DASHBOARD_FEATURE.to_string()]);
    let sender = {
        let mut state = state.write().await;
        let Some(client) = state.clients.get_mut(client_id) else {
            return false;
        };
        if (client.authenticated && !client.admin) || client.room_id.is_some() {
            warn!("Administrator token on a session connection client_id={client_id}");
            return false;
        }
        client.authenticated = true;
        client.admin = true;
        client.user_id = claims.sub;
        client.user_name = user_name.clone();
        client.session_expires_at = Some(claims.exp as u64);
        client.authentication_version = client.authentication_version.wrapping_add(1);
        info!("Administrator authenticated client_id={client_id} user={user_name:?}");
        client.sender.clone()
    };
    send_message(
        Some(sender),
        &auth_success_message(client_id, &user_name, protocol_version, features.as_deref()),
        Some(client_id),
    );
    crate::admin::send_admin_rooms_to(client_id, state).await;
    true
}

async fn handle_identity(
    client_id: &str,
    payload: &serde_json::Value,
    state: &SharedState,
    protocol_version: Option<u64>,
    features: Option<&[String]>,
) {
    let user_name = payload
        .get("user_name")
        .and_then(|v| v.as_str())
        .and_then(sanitize_name);
    let user_id = payload.get("user_id").and_then(|v| v.as_str());
    let (sender, stored_name) = {
        let mut state = state.write().await;
        if let Some(client) = state.clients.get_mut(client_id) {
            if let Some(name) = user_name {
                client.user_name = name.clone();
                if let Some(uid) = user_id {
                    client.user_id = uid.to_string();
                }
                info!("Client identified client_id={client_id} user={name:?}");
            }
            client.supports_host_transfer = features
                .is_some_and(|features| features.iter().any(|f| f == HOST_TRANSFER_FEATURE));
            client.supports_shared_playback_control = features
                .is_some_and(|features| features.iter().any(|f| f == SHARED_PLAYBACK_FEATURE));
            client.supports_room_moderation = features
                .is_some_and(|features| features.iter().any(|f| f == ROOM_MODERATION_FEATURE));
            client.supports_room_administrator = features
                .is_some_and(|features| features.iter().any(|f| f == ROOM_ADMINISTRATOR_FEATURE));
            client.supports_room_access =
                features.is_some_and(|features| features.iter().any(|f| f == ROOM_ACCESS_FEATURE));
            client.supports_room_permissions = features
                .is_some_and(|features| features.iter().any(|f| f == ROOM_PERMISSIONS_FEATURE));
            client.supports_media_queue =
                features.is_some_and(|features| features.iter().any(|f| f == MEDIA_QUEUE_FEATURE));
            client.supports_queue_suggestions = features
                .is_some_and(|features| features.iter().any(|f| f == QUEUE_SUGGESTIONS_FEATURE));
            client.supports_start_when_ready = features
                .is_some_and(|features| features.iter().any(|f| f == START_WHEN_READY_FEATURE));
            client.supports_chat_history =
                features.is_some_and(|features| features.iter().any(|f| f == CHAT_HISTORY_FEATURE));
            client.supports_chat_typing =
                features.is_some_and(|features| features.iter().any(|f| f == CHAT_TYPING_FEATURE));
            client.supports_user_avatars =
                features.is_some_and(|features| features.iter().any(|f| f == USER_AVATARS_FEATURE));
            (Some(client.sender.clone()), client.user_name.clone())
        } else {
            (None, String::new())
        }
    };
    // Insecure clients were already authenticated at connection time. Only
    // feature-aware clients need the new acknowledgement.
    if features.is_some() {
        send_message(
            sender,
            &auth_success_message(client_id, &stored_name, protocol_version, features),
            Some(client_id),
        );
    }
    if features.is_some_and(|features| features.iter().any(|f| f == ROOM_ACCESS_FEATURE)) {
        send_room_list(client_id, state).await;
    }
    refresh_room_capabilities(client_id, state).await;
}

pub(in crate::ws) async fn handle_auth(
    client_id: &str,
    parsed: &IncomingMessage,
    state: &SharedState,
    jwt_config: &Arc<JwtConfig>,
) {
    let declared_version = match declared_protocol_version(parsed.payload.as_ref()) {
        Ok(version) => version,
        Err(()) => {
            warn!("Malformed protocol_version client_id={client_id}");
            reject_unsupported_protocol_version(
                client_id,
                state,
                &format!(
                    "Invalid protocol_version field (server protocol version {PROTOCOL_VERSION})"
                ),
            )
            .await;
            return;
        }
    };
    if let Some(version) = declared_version {
        if version != PROTOCOL_VERSION {
            warn!("Unsupported protocol version client_id={client_id} version={version}");
            reject_unsupported_protocol_version(
                client_id,
                state,
                &format!(
                    "Protocol version {version} is not supported (server protocol version {PROTOCOL_VERSION})"
                ),
            )
            .await;
            return;
        }
    }
    let mut features = declared_features(parsed.payload.as_ref());
    if !jwt_config.enabled || state.read().await.saved_room_store.is_none() {
        if let Some(features) = features.as_mut() {
            features.retain(|f| f != PERSISTENT_ROOMS_FEATURE);
        }
    }

    if let Some(payload) = &parsed.payload {
        if let Some(token) = payload.get("token").and_then(|v| v.as_str()) {
            if handle_jwt_auth(
                client_id,
                token,
                state,
                jwt_config,
                declared_version,
                features.as_deref(),
            )
            .await
            {
                return;
            }
            if handle_admin_auth(
                client_id,
                token,
                payload,
                state,
                jwt_config,
                declared_version,
            )
            .await
            {
                return;
            }
            send_error(
                client_id,
                state,
                ErrorCode::AuthenticationFailed,
                "Authentication failed",
            )
            .await;
            return;
        }
        if !jwt_config.enabled {
            handle_identity(
                client_id,
                payload,
                state,
                declared_version,
                features.as_deref(),
            )
            .await;
        } else {
            warn!("Auth without token while JWT is required client_id={client_id}");
            send_error(
                client_id,
                state,
                ErrorCode::AuthenticationRequired,
                "Authentication required: no token provided",
            )
            .await;
        }
    } else if jwt_config.enabled {
        warn!("Auth with no payload while JWT is required client_id={client_id}");
        send_error(
            client_id,
            state,
            ErrorCode::AuthenticationRequired,
            "Authentication required: no token provided",
        )
        .await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::Claims;
    use crate::test_helpers;
    use jsonwebtoken::{encode, EncodingKey, Header};

    fn assert_error_code(message: WsMessage, code: &str) {
        assert_eq!(message.msg_type, ServerMessageType::Error);
        assert_eq!(message.payload.unwrap()["code"], code);
    }

    fn signed_jwt_config() -> Arc<JwtConfig> {
        Arc::new(JwtConfig {
            secret: "test-secret-with-at-least-32-characters".to_string(),
            audience: "OpenWatchParty".to_string(),
            issuer: "Jellyfin".to_string(),
            enabled: true,
        })
    }

    fn signed_token(jwt_config: &JwtConfig, sub: &str, typ: Option<&str>) -> String {
        let now = (crate::utils::now_ms() / 1000) as usize;
        encode(
            &Header::default(),
            &Claims {
                sub: sub.to_string(),
                name: "Admin".to_string(),
                aud: jwt_config.audience.clone(),
                iss: jwt_config.issuer.clone(),
                exp: now + 300,
                iat: now,
                typ: typ.map(str::to_string),
            },
            &EncodingKey::from_secret(jwt_config.secret.as_bytes()),
        )
        .unwrap()
    }

    fn dashboard_auth_message(token: &str) -> IncomingMessage {
        IncomingMessage {
            msg_type: crate::types::ClientMessageType::Auth,
            room: None,
            client: None,
            payload: Some(serde_json::json!({
                "token": token,
                "features": [crate::ws::constants::ROOM_DASHBOARD_FEATURE]
            })),
            ts: crate::utils::now_ms(),
            server_ts: None,
        }
    }

    #[tokio::test]
    async fn admin_auth_sends_the_rooms_and_no_room_list() {
        let state = test_helpers::create_state();
        let (host, _host_rx) = test_helpers::create_client_with_rx("u-host", "Host", true);
        let (admin, mut rx) = test_helpers::create_client_with_rx("", "", false);
        {
            let mut locked = state.write().await;
            locked.clients.insert("host".to_string(), host);
            locked.clients.insert("admin".to_string(), admin);
            let mut room = test_helpers::create_room("r1", "host");
            room.name = "Movie night".to_string();
            locked.rooms.insert("r1".to_string(), room);
        }
        let jwt_config = signed_jwt_config();
        let token = signed_token(&jwt_config, "u-admin", Some(crate::auth::ADMIN_TOKEN_TYPE));

        handle_auth(
            "admin",
            &dashboard_auth_message(&token),
            &state,
            &jwt_config,
        )
        .await;

        let success = test_helpers::recv_msg(&mut rx).unwrap();
        assert_eq!(success.msg_type, ServerMessageType::AuthSuccess);
        assert_eq!(
            success.payload.unwrap()["features"],
            serde_json::json!(["room_dashboard"])
        );
        let rooms = test_helpers::recv_msg(&mut rx).unwrap();
        assert_eq!(rooms.msg_type, ServerMessageType::AdminRooms);
        assert_eq!(rooms.payload.unwrap()["rooms"][0]["name"], "Movie night");
        assert!(test_helpers::recv_msg(&mut rx).is_none());
        let locked = state.read().await;
        let admin = &locked.clients["admin"];
        assert!(admin.admin && admin.authenticated);
        assert_eq!(admin.user_id, "u-admin");
        assert!(admin.session_expires_at.is_some());
    }

    #[tokio::test]
    async fn connections_do_not_change_kind() {
        let jwt_config = signed_jwt_config();
        let admin_token = signed_token(&jwt_config, "u-admin", Some(crate::auth::ADMIN_TOKEN_TYPE));
        let session_token = signed_token(&jwt_config, "u-user", None);

        let state = test_helpers::create_state();
        let (session, mut session_rx) = test_helpers::create_client_with_rx("u-user", "User", true);
        let (mut admin, mut admin_rx) =
            test_helpers::create_client_with_rx("u-admin", "Admin", true);
        admin.admin = true;
        {
            let mut locked = state.write().await;
            locked.clients.insert("session".to_string(), session);
            locked.clients.insert("admin".to_string(), admin);
        }

        handle_auth(
            "session",
            &dashboard_auth_message(&admin_token),
            &state,
            &jwt_config,
        )
        .await;
        handle_auth(
            "admin",
            &dashboard_auth_message(&session_token),
            &state,
            &jwt_config,
        )
        .await;

        assert_error_code(
            test_helpers::recv_msg(&mut session_rx).unwrap(),
            "AUTHENTICATION_FAILED",
        );
        assert_error_code(
            test_helpers::recv_msg(&mut admin_rx).unwrap(),
            "AUTHENTICATION_FAILED",
        );
        let locked = state.read().await;
        assert!(!locked.clients["session"].admin);
        assert_eq!(locked.clients["session"].user_id, "u-user");
        assert!(locked.clients["admin"].admin);
        assert_eq!(locked.clients["admin"].user_id, "u-admin");
    }

    #[tokio::test]
    async fn successful_auth_sends_success_before_room_list() {
        let state = test_helpers::create_state();
        let (client, mut rx) = test_helpers::create_client_with_rx("user", "", false);
        state
            .write()
            .await
            .clients
            .insert("client".to_string(), client);
        let jwt_config = Arc::new(JwtConfig {
            secret: "test-secret-with-at-least-32-characters".to_string(),
            audience: "OpenWatchParty".to_string(),
            issuer: "Jellyfin".to_string(),
            enabled: true,
        });
        let now = (crate::utils::now_ms() / 1000) as usize;
        let token = encode(
            &Header::default(),
            &Claims {
                sub: "user".to_string(),
                name: "Alice".to_string(),
                aud: jwt_config.audience.clone(),
                iss: jwt_config.issuer.clone(),
                exp: now + 3600,
                iat: now,
                typ: None,
            },
            &EncodingKey::from_secret(jwt_config.secret.as_bytes()),
        )
        .unwrap();
        let parsed = IncomingMessage {
            msg_type: crate::types::ClientMessageType::Auth,
            room: None,
            client: Some("forged".to_string()),
            payload: Some(serde_json::json!({ "token": token })),
            ts: crate::utils::now_ms(),
            server_ts: None,
        };

        handle_auth("client", &parsed, &state, &jwt_config).await;

        assert_eq!(
            test_helpers::recv_msg(&mut rx).unwrap().msg_type,
            ServerMessageType::AuthSuccess
        );
        assert_eq!(
            test_helpers::recv_msg(&mut rx).unwrap().msg_type,
            ServerMessageType::RoomList
        );
        assert!(state.read().await.clients["client"].authenticated);
        assert_eq!(
            state.read().await.clients["client"].session_expires_at,
            Some((now + 3600) as u64)
        );
    }

    #[tokio::test]
    async fn insecure_auth_with_token_remains_non_expiring() {
        let state = test_helpers::create_state();
        let (client, _rx) = test_helpers::create_client_with_rx("anonymous", "Anonymous", true);
        state
            .write()
            .await
            .clients
            .insert("client".to_string(), client);
        let jwt_config = Arc::new(JwtConfig {
            secret: String::new(),
            audience: "OpenWatchParty".to_string(),
            issuer: "Jellyfin".to_string(),
            enabled: false,
        });
        let parsed = IncomingMessage {
            msg_type: crate::types::ClientMessageType::Auth,
            room: None,
            client: None,
            payload: Some(serde_json::json!({ "token": "ignored-in-insecure-mode" })),
            ts: crate::utils::now_ms(),
            server_ts: None,
        };

        handle_auth("client", &parsed, &state, &jwt_config).await;

        assert_eq!(
            state.read().await.clients["client"].session_expires_at,
            None
        );
    }

    #[tokio::test]
    async fn jwt_names_are_sanitized_and_empty_names_are_rejected() {
        let state = test_helpers::create_state();
        let (client, _rx) = test_helpers::create_client_with_rx("user", "", false);
        state
            .write()
            .await
            .clients
            .insert("client".to_string(), client);
        let jwt_config = Arc::new(JwtConfig {
            secret: "test-secret".to_string(),
            audience: "OpenWatchParty".to_string(),
            issuer: "Jellyfin".to_string(),
            enabled: true,
        });
        let now = (crate::utils::now_ms() / 1000) as usize;
        let token_for = |name: String| {
            encode(
                &Header::default(),
                &Claims {
                    sub: "user".to_string(),
                    name,
                    aud: jwt_config.audience.clone(),
                    iss: jwt_config.issuer.clone(),
                    exp: now + 3600,
                    iat: now,
                    typ: None,
                },
                &EncodingKey::from_secret(jwt_config.secret.as_bytes()),
            )
            .unwrap()
        };

        assert!(
            handle_jwt_auth(
                "client",
                &token_for(format!("  Alice\0{}  ", "界".repeat(120))),
                &state,
                &jwt_config,
                None,
                None,
            )
            .await
        );
        let stored_name = state.read().await.clients["client"].user_name.clone();
        assert!(
            stored_name.starts_with("Alice"),
            "stored name: {stored_name:?}"
        );
        assert!(!stored_name.chars().any(char::is_control));
        assert!(stored_name.chars().count() <= super::super::super::constants::MAX_NAME_LENGTH);

        assert!(
            !handle_jwt_auth(
                "client",
                &token_for("\0\n\r".to_string()),
                &state,
                &jwt_config,
                None,
                None,
            )
            .await
        );
    }

    #[tokio::test]
    async fn authentication_failures_have_stable_codes() {
        let state = test_helpers::create_state();
        let (client, mut rx) = test_helpers::create_client_with_rx("user", "", false);
        state
            .write()
            .await
            .clients
            .insert("client".to_string(), client);
        let jwt_config = Arc::new(JwtConfig {
            secret: "test-secret-with-at-least-32-characters".to_string(),
            audience: "OpenWatchParty".to_string(),
            issuer: "Jellyfin".to_string(),
            enabled: true,
        });

        let invalid = IncomingMessage {
            msg_type: crate::types::ClientMessageType::Auth,
            room: None,
            client: None,
            payload: Some(serde_json::json!({ "token": "invalid" })),
            ts: 0,
            server_ts: None,
        };
        handle_auth("client", &invalid, &state, &jwt_config).await;
        assert_error_code(
            test_helpers::recv_msg(&mut rx).unwrap(),
            "AUTHENTICATION_FAILED",
        );

        let missing = IncomingMessage {
            payload: Some(serde_json::json!({})),
            ..invalid
        };
        handle_auth("client", &missing, &state, &jwt_config).await;
        assert_error_code(
            test_helpers::recv_msg(&mut rx).unwrap(),
            "AUTHENTICATION_REQUIRED",
        );
    }

    fn insecure_jwt_config() -> Arc<JwtConfig> {
        Arc::new(JwtConfig {
            secret: String::new(),
            audience: "OpenWatchParty".to_string(),
            issuer: "Jellyfin".to_string(),
            enabled: false,
        })
    }

    fn auth_message(payload: serde_json::Value) -> IncomingMessage {
        IncomingMessage {
            msg_type: crate::types::ClientMessageType::Auth,
            room: None,
            client: None,
            payload: Some(payload),
            ts: crate::utils::now_ms(),
            server_ts: None,
        }
    }

    #[tokio::test]
    async fn missing_protocol_version_defaults_to_v1() {
        let state = test_helpers::create_state();
        let (client, mut rx) = test_helpers::create_client_with_rx("user", "", false);
        state
            .write()
            .await
            .clients
            .insert("client".to_string(), client);

        handle_auth(
            "client",
            &auth_message(serde_json::json!({ "user_name": "Bob" })),
            &state,
            &insecure_jwt_config(),
        )
        .await;

        assert_eq!(state.read().await.clients["client"].user_name, "Bob");
        assert!(test_helpers::recv_msg(&mut rx).is_none());
    }

    #[tokio::test]
    async fn current_protocol_version_is_accepted() {
        let state = test_helpers::create_state();
        let (client, mut rx) = test_helpers::create_client_with_rx("user", "", false);
        state
            .write()
            .await
            .clients
            .insert("client".to_string(), client);

        handle_auth(
            "client",
            &auth_message(
                serde_json::json!({ "user_name": "Bob", "protocol_version": PROTOCOL_VERSION }),
            ),
            &state,
            &insecure_jwt_config(),
        )
        .await;

        assert_eq!(state.read().await.clients["client"].user_name, "Bob");
        assert!(test_helpers::recv_msg(&mut rx).is_none());
    }

    #[tokio::test]
    async fn unsupported_protocol_versions_are_rejected_and_closed() {
        for version in [0, PROTOCOL_VERSION + 1, u64::MAX] {
            let state = test_helpers::create_state();
            let (client, mut rx) = test_helpers::create_client_with_rx("user", "Alice", true);
            state
                .write()
                .await
                .clients
                .insert("client".to_string(), client);

            handle_auth(
                "client",
                &auth_message(serde_json::json!({ "protocol_version": version })),
                &state,
                &insecure_jwt_config(),
            )
            .await;

            let error = test_helpers::recv_msg(&mut rx).unwrap();
            assert_eq!(error.msg_type, ServerMessageType::Error);
            let payload = error.payload.unwrap();
            assert_eq!(payload["code"], "PROTOCOL_VERSION_UNSUPPORTED");
            assert!(
                payload["message"]
                    .as_str()
                    .unwrap()
                    .contains(&version.to_string()),
                "message must name the requested version: {payload:?}"
            );

            let close = rx.recv().await.unwrap().unwrap();
            assert_eq!(
                close.close_frame(),
                Some((
                    super::super::super::constants::POLICY_VIOLATION_CLOSE_CODE,
                    "Unsupported protocol version"
                ))
            );
        }
    }

    #[tokio::test]
    async fn malformed_protocol_version_is_rejected() {
        let state = test_helpers::create_state();
        let (client, mut rx) = test_helpers::create_client_with_rx("user", "Alice", true);
        state
            .write()
            .await
            .clients
            .insert("client".to_string(), client);

        handle_auth(
            "client",
            &auth_message(serde_json::json!({ "protocol_version": "1" })),
            &state,
            &insecure_jwt_config(),
        )
        .await;

        let payload = test_helpers::recv_msg(&mut rx).unwrap().payload.unwrap();
        assert_eq!(payload["code"], "PROTOCOL_VERSION_UNSUPPORTED");
        assert!(payload["message"]
            .as_str()
            .unwrap()
            .contains("Invalid protocol_version"));
    }

    #[tokio::test]
    async fn auth_success_echoes_only_a_declared_protocol_version() {
        for declared in [None, Some(PROTOCOL_VERSION)] {
            let state = test_helpers::create_state();
            let (client, mut rx) = test_helpers::create_client_with_rx("user", "", false);
            state
                .write()
                .await
                .clients
                .insert("client".to_string(), client);
            let jwt_config = Arc::new(JwtConfig {
                secret: "test-secret-with-at-least-32-characters".to_string(),
                audience: "OpenWatchParty".to_string(),
                issuer: "Jellyfin".to_string(),
                enabled: true,
            });
            let now = (crate::utils::now_ms() / 1000) as usize;
            let token = encode(
                &Header::default(),
                &Claims {
                    sub: "user".to_string(),
                    name: "Alice".to_string(),
                    aud: jwt_config.audience.clone(),
                    iss: jwt_config.issuer.clone(),
                    exp: now + 3600,
                    iat: now,
                    typ: None,
                },
                &EncodingKey::from_secret(jwt_config.secret.as_bytes()),
            )
            .unwrap();
            let mut payload = serde_json::json!({ "token": token });
            if let Some(version) = declared {
                payload["protocol_version"] = serde_json::json!(version);
            }

            handle_auth("client", &auth_message(payload), &state, &jwt_config).await;

            let success = test_helpers::recv_msg(&mut rx).unwrap();
            assert_eq!(success.msg_type, ServerMessageType::AuthSuccess);
            assert_eq!(
                success.payload.unwrap()["protocol_version"].as_u64(),
                declared
            );
        }
    }

    #[tokio::test]
    async fn participant_status_is_echoed_when_declared() {
        for (declared, expected) in [
            (
                serde_json::json!(["participant_status"]),
                serde_json::json!(["participant_status"]),
            ),
            (
                serde_json::json!(["host_transfer", "participant_status"]),
                serde_json::json!(["host_transfer", "participant_status"]),
            ),
            (
                serde_json::json!(["host_transfer"]),
                serde_json::json!(["host_transfer"]),
            ),
            (
                serde_json::json!(["participant_tracks", "unknown"]),
                serde_json::json!(["participant_tracks"]),
            ),
        ] {
            let state = test_helpers::create_state();
            let (client, mut rx) = test_helpers::create_client_with_rx("user", "Anonymous", true);
            state
                .write()
                .await
                .clients
                .insert("client".to_string(), client);

            handle_auth(
                "client",
                &auth_message(serde_json::json!({
                    "user_name": "Bob",
                    "features": declared,
                })),
                &state,
                &insecure_jwt_config(),
            )
            .await;

            let success = test_helpers::recv_msg(&mut rx).unwrap();
            assert_eq!(success.payload.unwrap()["features"], expected);
        }
    }

    #[tokio::test]
    async fn insecure_auth_stores_and_echoes_supported_features_when_declared() {
        for (declared, expected) in [
            (serde_json::json!(["host_transfer", "future"]), true),
            (serde_json::json!(["future", 7, null]), false),
            (serde_json::json!("host_transfer"), false),
        ] {
            let state = test_helpers::create_state();
            let (client, mut rx) = test_helpers::create_client_with_rx("user", "Anonymous", true);
            state
                .write()
                .await
                .clients
                .insert("client".to_string(), client);

            handle_auth(
                "client",
                &auth_message(serde_json::json!({
                    "user_name": "Bob",
                    "features": declared,
                })),
                &state,
                &insecure_jwt_config(),
            )
            .await;

            assert_eq!(
                state.read().await.clients["client"].supports_host_transfer,
                expected
            );
            let success = test_helpers::recv_msg(&mut rx).unwrap();
            assert_eq!(success.msg_type, ServerMessageType::AuthSuccess);
            assert_eq!(
                success.payload.unwrap()["features"],
                if expected {
                    serde_json::json!(["host_transfer"])
                } else {
                    serde_json::json!([])
                }
            );
        }
    }

    #[tokio::test]
    async fn insecure_auth_without_valid_features_does_not_enable_host_transfer() {
        for payload in [
            serde_json::json!({ "user_name": "Bob" }),
            serde_json::json!({
                "user_name": "Bob",
                "features": "host_transfer"
            }),
        ] {
            let state = test_helpers::create_state();
            let (client, _rx) = test_helpers::create_client_with_rx("user", "Anonymous", true);
            state
                .write()
                .await
                .clients
                .insert("client".to_string(), client);

            handle_auth(
                "client",
                &auth_message(payload),
                &state,
                &insecure_jwt_config(),
            )
            .await;

            assert!(!state.read().await.clients["client"].supports_host_transfer);
        }
    }

    #[tokio::test]
    async fn omitted_features_are_not_echoed_on_jwt_auth() {
        let state = test_helpers::create_state();
        let (client, mut rx) = test_helpers::create_client_with_rx("user", "", false);
        state
            .write()
            .await
            .clients
            .insert("client".to_string(), client);
        let jwt_config = Arc::new(JwtConfig {
            secret: "test-secret-with-at-least-32-characters".to_string(),
            audience: "OpenWatchParty".to_string(),
            issuer: "Jellyfin".to_string(),
            enabled: true,
        });
        let now = (crate::utils::now_ms() / 1000) as usize;
        let token = encode(
            &Header::default(),
            &Claims {
                sub: "user".to_string(),
                name: "Alice".to_string(),
                aud: jwt_config.audience.clone(),
                iss: jwt_config.issuer.clone(),
                exp: now + 3600,
                iat: now,
                typ: None,
            },
            &EncodingKey::from_secret(jwt_config.secret.as_bytes()),
        )
        .unwrap();

        handle_auth(
            "client",
            &auth_message(serde_json::json!({ "token": token })),
            &state,
            &jwt_config,
        )
        .await;

        let success = test_helpers::recv_msg(&mut rx).unwrap();
        assert!(success.payload.unwrap().get("features").is_none());
        assert!(!state.read().await.clients["client"].supports_host_transfer);
    }

    #[tokio::test]
    async fn jwt_auth_stores_and_echoes_host_transfer() {
        let state = test_helpers::create_state();
        let (client, mut rx) = test_helpers::create_client_with_rx("user", "", false);
        state
            .write()
            .await
            .clients
            .insert("client".to_string(), client);
        let jwt_config = Arc::new(JwtConfig {
            secret: "test-secret-with-at-least-32-characters".to_string(),
            audience: "OpenWatchParty".to_string(),
            issuer: "Jellyfin".to_string(),
            enabled: true,
        });
        let now = (crate::utils::now_ms() / 1000) as usize;
        let token = encode(
            &Header::default(),
            &Claims {
                sub: "user".to_string(),
                name: "Alice".to_string(),
                aud: jwt_config.audience.clone(),
                iss: jwt_config.issuer.clone(),
                exp: now + 3600,
                iat: now,
                typ: None,
            },
            &EncodingKey::from_secret(jwt_config.secret.as_bytes()),
        )
        .unwrap();

        handle_auth(
            "client",
            &auth_message(serde_json::json!({
                "token": token,
                "features": ["host_transfer", "shared_playback_control", "room_moderation", "room_permissions", "media_queue", "queue_suggestions", "start_when_ready", "chat_history", "chat_typing", "user_avatars", "future"]
            })),
            &state,
            &jwt_config,
        )
        .await;

        assert!(state.read().await.clients["client"].supports_host_transfer);
        assert!(state.read().await.clients["client"].supports_shared_playback_control);
        assert!(state.read().await.clients["client"].supports_room_moderation);
        assert!(state.read().await.clients["client"].supports_room_permissions);
        assert!(state.read().await.clients["client"].supports_media_queue);
        assert!(state.read().await.clients["client"].supports_queue_suggestions);
        assert!(state.read().await.clients["client"].supports_start_when_ready);
        assert!(state.read().await.clients["client"].supports_chat_history);
        assert!(state.read().await.clients["client"].supports_chat_typing);
        assert!(state.read().await.clients["client"].supports_user_avatars);
        assert_eq!(
            test_helpers::recv_msg(&mut rx).unwrap().payload.unwrap()["features"],
            serde_json::json!([
                "host_transfer",
                "shared_playback_control",
                "room_moderation",
                "room_permissions",
                "media_queue",
                "queue_suggestions",
                "start_when_ready",
                "chat_history",
                "chat_typing",
                "user_avatars"
            ])
        );
    }

    #[tokio::test]
    async fn insecure_room_moderation_is_negotiated_and_cleared_on_reauth() {
        let state = test_helpers::create_state();
        let (client, mut rx) = test_helpers::create_client_with_rx("user", "Guest", true);
        state.write().await.clients.insert("client".into(), client);
        for (declared, expected) in [
            (serde_json::json!(["room_moderation", "future"]), true),
            (serde_json::json!([]), false),
        ] {
            handle_auth(
                "client",
                &auth_message(serde_json::json!({ "user_name": "Guest", "features": declared })),
                &state,
                &insecure_jwt_config(),
            )
            .await;
            assert_eq!(
                state.read().await.clients["client"].supports_room_moderation,
                expected
            );
            let features =
                test_helpers::recv_msg(&mut rx).unwrap().payload.unwrap()["features"].clone();
            assert_eq!(
                features,
                if expected {
                    serde_json::json!(["room_moderation"])
                } else {
                    serde_json::json!([])
                }
            );
        }
    }

    #[tokio::test]
    async fn insecure_shared_capability_is_negotiated_and_cleared_on_reauth() {
        let state = test_helpers::create_state();
        let (client, mut rx) = test_helpers::create_client_with_rx("user", "Guest", true);
        state.write().await.clients.insert("client".into(), client);
        for (declared, expected) in [
            (
                serde_json::json!(["shared_playback_control", "future"]),
                true,
            ),
            (serde_json::json!([]), false),
            (serde_json::json!("shared_playback_control"), false),
        ] {
            handle_auth(
                "client",
                &auth_message(serde_json::json!({ "user_name": "Guest", "features": declared })),
                &state,
                &insecure_jwt_config(),
            )
            .await;
            assert_eq!(
                state.read().await.clients["client"].supports_shared_playback_control,
                expected
            );
            let features =
                test_helpers::recv_msg(&mut rx).unwrap().payload.unwrap()["features"].clone();
            assert_eq!(
                features,
                if expected {
                    serde_json::json!(["shared_playback_control"])
                } else {
                    serde_json::json!([])
                }
            );
        }
    }

    #[tokio::test]
    async fn room_permissions_feature_is_negotiated_and_cleared_on_reauth() {
        let state = test_helpers::create_state();
        let (client, mut rx) = test_helpers::create_client_with_rx("user", "Guest", true);
        state.write().await.clients.insert("client".into(), client);
        for (declared, expected) in [
            (serde_json::json!(["room_permissions", "future"]), true),
            (serde_json::json!([]), false),
            (serde_json::json!("room_permissions"), false),
        ] {
            handle_auth(
                "client",
                &auth_message(serde_json::json!({ "user_name": "Guest", "features": declared })),
                &state,
                &insecure_jwt_config(),
            )
            .await;
            assert_eq!(
                state.read().await.clients["client"].supports_room_permissions,
                expected
            );
            let features =
                test_helpers::recv_msg(&mut rx).unwrap().payload.unwrap()["features"].clone();
            assert_eq!(
                features,
                if expected {
                    serde_json::json!(["room_permissions"])
                } else {
                    serde_json::json!([])
                }
            );
        }
    }

    #[tokio::test]
    async fn reauth_in_room_sends_current_room_permissions() {
        let state = test_helpers::create_state();
        let (mut client, mut rx) = test_helpers::create_client_with_rx("user", "Guest", true);
        client.room_id = Some("room".into());
        let mut room = test_helpers::create_room("room", "host");
        room.clients.push("client".into());
        room.permissions = crate::types::RoomPermissions {
            seek: true,
            change_media: false,
            edit_queue: true,
        };
        {
            let mut locked = state.write().await;
            locked.clients.insert("client".into(), client);
            locked.rooms.insert("room".into(), room);
        }

        handle_auth(
            "client",
            &auth_message(serde_json::json!({
                "user_name": "Guest",
                "features": ["room_permissions"]
            })),
            &state,
            &insecure_jwt_config(),
        )
        .await;

        assert_eq!(
            test_helpers::recv_msg(&mut rx).unwrap().msg_type,
            ServerMessageType::AuthSuccess
        );
        let permissions = test_helpers::recv_msg(&mut rx).unwrap();
        assert_eq!(permissions.msg_type, ServerMessageType::RoomPermissions);
        assert_eq!(
            permissions.payload.unwrap(),
            serde_json::json!({"seek": true, "change_media": false, "edit_queue": true})
        );
    }

    #[tokio::test]
    async fn start_when_ready_capability_is_negotiated_and_cleared_on_reauth() {
        let state = test_helpers::create_state();
        let (client, mut rx) = test_helpers::create_client_with_rx("user", "Guest", true);
        state.write().await.clients.insert("client".into(), client);
        for (declared, expected) in [
            (serde_json::json!(["start_when_ready"]), true),
            (serde_json::json!([]), false),
        ] {
            handle_auth(
                "client",
                &auth_message(serde_json::json!({ "user_name": "Guest", "features": declared })),
                &state,
                &insecure_jwt_config(),
            )
            .await;
            assert_eq!(
                state.read().await.clients["client"].supports_start_when_ready,
                expected
            );
            assert_eq!(
                test_helpers::recv_msg(&mut rx).unwrap().payload.unwrap()["features"],
                declared
            );
        }
    }

    #[tokio::test]
    async fn chat_history_capability_is_negotiated_and_cleared_on_reauth() {
        let state = test_helpers::create_state();
        let (client, mut rx) = test_helpers::create_client_with_rx("user", "Guest", true);
        state.write().await.clients.insert("client".into(), client);
        for (declared, expected) in [
            (serde_json::json!(["chat_history"]), true),
            (serde_json::json!([]), false),
        ] {
            handle_auth(
                "client",
                &auth_message(serde_json::json!({ "user_name": "Guest", "features": declared })),
                &state,
                &insecure_jwt_config(),
            )
            .await;
            assert_eq!(
                state.read().await.clients["client"].supports_chat_history,
                expected
            );
            assert_eq!(
                test_helpers::recv_msg(&mut rx).unwrap().payload.unwrap()["features"],
                declared
            );
        }
    }

    #[tokio::test]
    async fn media_queue_capability_is_negotiated_and_cleared_on_reauth() {
        let state = test_helpers::create_state();
        let (client, mut rx) = test_helpers::create_client_with_rx("user", "Guest", true);
        state.write().await.clients.insert("client".into(), client);
        for (declared, expected) in [
            (serde_json::json!(["media_queue"]), true),
            (serde_json::json!([]), false),
        ] {
            handle_auth(
                "client",
                &auth_message(serde_json::json!({ "user_name": "Guest", "features": declared })),
                &state,
                &insecure_jwt_config(),
            )
            .await;
            assert_eq!(
                state.read().await.clients["client"].supports_media_queue,
                expected
            );
            assert_eq!(
                test_helpers::recv_msg(&mut rx).unwrap().payload.unwrap()["features"],
                declared
            );
        }
    }

    #[tokio::test]
    async fn queue_suggestions_capability_is_negotiated_and_cleared_on_identity() {
        let state = test_helpers::create_state();
        let (client, mut rx) = test_helpers::create_client_with_rx("user", "Guest", true);
        state.write().await.clients.insert("client".into(), client);
        for (declared, expected) in [
            (serde_json::json!(["queue_suggestions"]), true),
            (serde_json::json!([]), false),
        ] {
            handle_auth(
                "client",
                &auth_message(serde_json::json!({ "user_name": "Guest", "features": declared })),
                &state,
                &insecure_jwt_config(),
            )
            .await;
            assert_eq!(
                state.read().await.clients["client"].supports_queue_suggestions,
                expected
            );
            assert_eq!(
                test_helpers::recv_msg(&mut rx).unwrap().payload.unwrap()["features"],
                declared
            );
        }
    }
}

#[cfg(test)]
mod access_tests {
    use super::*;

    #[test]
    fn room_access_is_echoed_only_when_declared() {
        let payload = serde_json::json!({"features": ["room_access", "future"]});
        let features = declared_features(Some(&payload)).unwrap();
        assert_eq!(features, vec!["room_access"]);
        let msg = auth_success_message("client", "Host", Some(1), Some(&features));
        assert_eq!(
            msg.payload.unwrap()["features"],
            serde_json::json!(["room_access"])
        );
        assert!(declared_features(None).is_none());
    }
}
