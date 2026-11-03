use super::*;
use crate::{
    persistence::SavedRoom,
    room::{participant_statuses_message, participant_tracks_message, QueueItem},
    types::{Room, ServerState},
};
fn restore(snapshot: SavedRoom, client_id: &str, now: u64) -> Result<Room, StorageError> {
    snapshot.validate()?;
    let mut room = Room::new(
        uuid::Uuid::new_v4().to_string(),
        client_id.into(),
        snapshot.name,
        Some(snapshot.media_id),
        snapshot.position,
        now,
    );
    room.saved_session_id = Some(snapshot.id);
    room.saved_owner_user_id = Some(snapshot.owner_user_id);
    room.permissions = snapshot.permissions;
    room.access = snapshot.access;
    room.queue.items = snapshot
        .items
        .into_iter()
        .map(|item| QueueItem {
            id: item.id,
            title: item.title,
            series: item.series,
        })
        .collect();
    room.queue.last_added = snapshot.last_added;
    room.blocked_users = snapshot.blocked_users.into_iter().collect();
    room.admitted_users = snapshot.admitted_users.into_iter().collect();
    room.administrator_user_id = snapshot.administrator_user_id;
    Ok(room)
}
pub(super) async fn handle_resume(
    client_id: &str,
    ctx: &Context,
    request: &Request,
    state: &SharedState,
) {
    let id = request.id.as_deref().expect("validated checkpoint id");
    let generation = crate::types::next_pending_play_generation();
    let can_reserve = {
        let mut locked = state.write().await;
        if !locked
            .clients
            .get(client_id)
            .is_some_and(|c| still_authorized(ctx, c))
        {
            return;
        }
        if locked.clients[client_id].room_id.is_some() {
            Err(ErrorCode::SavedSessionAlreadyInRoom)
        } else if locked.saved_session_operations.contains_key(id)
            || locked
                .rooms
                .values()
                .any(|r| r.saved_session_id.as_deref() == Some(id))
        {
            Err(ErrorCode::SavedSessionBusy)
        } else {
            locked
                .saved_session_operations
                .insert(id.into(), generation);
            Ok(())
        }
    };
    if let Err(code) = can_reserve {
        failure(client_id, ctx, state, &request.request_id, code).await;
        return;
    }
    let snapshot = ctx.store.get(&ctx.user_id, id, now_ms()).await;
    let result = {
        let mut locked = state.write().await;
        let finish = |locked: &mut ServerState| -> Result<(), ErrorCode> {
            if locked.saved_session_operations.get(id) != Some(&generation) {
                return Err(ErrorCode::SavedSessionBusy);
            }
            locked.saved_session_operations.remove(id);
            let client = locked
                .clients
                .get(client_id)
                .filter(|c| still_authorized(ctx, c))
                .ok_or(ErrorCode::SavedSessionPermissionRequired)?;
            if client.room_id.is_some() {
                return Err(ErrorCode::SavedSessionAlreadyInRoom);
            }
            if locked
                .rooms
                .values()
                .any(|r| r.saved_session_id.as_deref() == Some(id))
            {
                return Err(ErrorCode::SavedSessionBusy);
            }
            let snapshot = snapshot.map_err(storage_code)?;
            let room = restore(snapshot, client_id, now_ms()).map_err(storage_code)?;
            let room_id = room.room_id.clone();
            let ServerState { clients, rooms, .. } = locked;
            let (sender, room_state) =
                super::super::create::insert_and_notify(client_id, room, &None, clients, rooms);
            // Acknowledgement precedes room_state so the new Owner's client knows
            // this state restores media rather than describing its current player.
            crate::messaging::send_message(
                sender.clone(),
                &WsMessage {
                    msg_type: ServerMessageType::SavedSessionResult,
                    room: None,
                    client: Some(client_id.into()),
                    payload: Some(
                        serde_json::json!({"request_id":request.request_id,"action":"resume","id":id,"room_id":room_id}),
                    ),
                    ts: now_ms(),
                    server_ts: Some(now_ms()),
                },
                Some(client_id),
            );
            crate::messaging::send_message(sender.clone(), &room_state, Some(client_id));
            let room = &rooms[&room_id];
            crate::room::access::send_access(room, clients);
            crate::room::send_room_capabilities(room, clients);
            crate::room::send_room_permissions(room, clients, Some(client_id));
            crate::room::send_room_administrator(room, clients, Some(client_id));
            crate::room::send_room_participant_list(room, clients);
            crate::messaging::send_message(
                sender.clone(),
                &participant_statuses_message(room),
                Some(client_id),
            );
            crate::messaging::send_message(
                sender,
                &participant_tracks_message(room),
                Some(client_id),
            );
            super::super::queue::send_queue_state(room, clients, Some(client_id));
            Ok(())
        };
        finish(&mut locked)
    };
    if let Err(code) = result {
        failure(client_id, ctx, state, &request.request_id, code).await
    } else {
        crate::messaging::broadcast_room_list(state).await
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::{message, state};
    use super::super::*;
    use crate::{
        test_helpers,
        types::{ClientMessageType, PlayState},
    };
    #[tokio::test]
    async fn resume_is_paused_with_queue_access_and_fresh_live_identity() {
        let (state, dir, mut rx) = state().await;
        let store = state.read().await.saved_room_store.clone().unwrap();
        let mut snapshot = test_helpers::saved_room("owner");
        snapshot.access.approval = true;
        snapshot.access.unlisted = true;
        snapshot.blocked_users = vec!["blocked".into()];
        snapshot.admitted_users = vec!["friend".into()];
        snapshot.administrator_user_id = Some("ana".into());
        snapshot.permissions.seek = true;
        let id = snapshot.id.clone();
        store.put(snapshot, 100).await.unwrap();
        let tasks = crate::tasks::AppTasks::new();
        handle_saved_sessions(
            "owner",
            &message(ClientMessageType::ResumeSavedSession, Some(&id)),
            &state,
            &tasks,
        )
        .await;
        {
            let locked = state.read().await;
            assert_eq!(locked.rooms.len(), 1);
            let room = locked.rooms.values().next().unwrap();
            assert_ne!(room.room_id, id);
            assert_eq!(room.state.position, 123.5);
            assert_eq!(room.state.play_state, PlayState::Paused);
            assert_eq!(room.queue.items.len(), 1);
            assert!(room.permissions.seek);
            assert!(room.access.approval && room.access.unlisted);
            assert!(room.blocked_users.contains("blocked"));
            assert!(room.admitted_users.contains("friend"));
            assert_eq!(room.administrator_user_id.as_deref(), Some("ana"));
            assert_eq!(room.saved_session_id.as_deref(), Some(id.as_str()));
            assert!(
                room.chat_history.is_empty()
                    && room.statuses.is_empty()
                    && room.pending_play.is_none()
                    && room.queue.countdown.is_none()
            );
        }
        assert!(store.get("owner", &id, 101).await.is_ok());
        assert!(std::iter::from_fn(|| test_helpers::recv_msg(&mut rx))
            .any(|m| m.msg_type == ServerMessageType::RoomState));
        tasks.cancel();
        tasks.wait().await;
        store.shutdown().await.unwrap();
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[tokio::test]
    async fn same_account_tabs_create_one_live_instance() {
        let (state, dir, _rx) = state().await;
        let store = state.read().await.saved_room_store.clone().unwrap();
        let snapshot = test_helpers::saved_room("owner");
        let id = snapshot.id.clone();
        store.put(snapshot, 100).await.unwrap();
        {
            let mut locked = state.write().await;
            let mut other = locked.clients["owner"].clone();
            let (sender, _rx, _) = crate::messaging::ClientSender::channel(100);
            other.sender = sender;
            locked.clients.insert("other-tab".into(), other);
        }
        let release = store.pause_for_test().await;
        let tasks = crate::tasks::AppTasks::new();
        let copy = state.clone();
        let taskcopy = tasks.clone();
        let idcopy = id.clone();
        let first = tokio::spawn(async move {
            handle_saved_sessions(
                "owner",
                &message(ClientMessageType::ResumeSavedSession, Some(&idcopy)),
                &copy,
                &taskcopy,
            )
            .await
        });
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            while store.pending_for_test() == 0 {
                tokio::task::yield_now().await
            }
        })
        .await
        .unwrap();
        handle_saved_sessions(
            "other-tab",
            &message(ClientMessageType::ResumeSavedSession, Some(&id)),
            &state,
            &tasks,
        )
        .await;
        release.send(()).unwrap();
        first.await.unwrap();
        assert_eq!(state.read().await.rooms.len(), 1);
        assert!(state.read().await.clients["other-tab"].room_id.is_none());
        tasks.cancel();
        tasks.wait().await;
        store.shutdown().await.unwrap();
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[tokio::test]
    async fn resume_rejects_existing_membership_and_foreign_checkpoint() {
        let (state, dir, mut rx) = state().await;
        let store = state.read().await.saved_room_store.clone().unwrap();
        let snapshot = test_helpers::saved_room("owner");
        let id = snapshot.id.clone();
        store.put(snapshot, 100).await.unwrap();
        {
            let mut locked = state.write().await;
            locked.rooms.insert(
                "current".into(),
                test_helpers::create_room("current", "owner"),
            );
            locked.clients.get_mut("owner").unwrap().room_id = Some("current".into());
        }
        let tasks = crate::tasks::AppTasks::new();
        handle_saved_sessions(
            "owner",
            &message(ClientMessageType::ResumeSavedSession, Some(&id)),
            &state,
            &tasks,
        )
        .await;
        assert_eq!(
            test_helpers::recv_msg(&mut rx).unwrap().payload.unwrap()["code"],
            "SAVED_SESSION_ALREADY_IN_ROOM"
        );
        assert!(store.get("owner", &id, 101).await.is_ok());
        {
            let mut locked = state.write().await;
            locked.rooms.clear();
            locked.clients.get_mut("owner").unwrap().room_id = None;
        }
        let foreign = test_helpers::saved_room("foreign");
        let id = foreign.id.clone();
        store.put(foreign, 100).await.unwrap();
        handle_saved_sessions(
            "owner",
            &message(ClientMessageType::ResumeSavedSession, Some(&id)),
            &state,
            &tasks,
        )
        .await;
        assert_eq!(
            test_helpers::recv_msg(&mut rx).unwrap().payload.unwrap()["code"],
            "SAVED_SESSION_NOT_FOUND"
        );
        assert!(state.read().await.rooms.is_empty());
        assert!(store.get("foreign", &id, 101).await.is_ok());
        tasks.cancel();
        tasks.wait().await;
        store.shutdown().await.unwrap();
        std::fs::remove_dir_all(dir).unwrap();
    }
}
