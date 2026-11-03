pub(crate) mod access;
mod close;
mod leave;
mod participants;
mod queue;

use crate::types::{Client, Room};
#[cfg(test)]
pub(crate) use close::close_room;
pub(crate) use close::close_room_in_state;
pub(crate) use close::close_room_parts;
pub(crate) use leave::handle_disconnect_if;
pub use leave::{handle_disconnect, handle_leave, send_leave_notification};
pub(crate) use leave::{handle_leave_without_transfer, host_changed_message};
pub(crate) use participants::send_room_administrator;
pub(crate) use participants::send_room_capabilities;
pub(crate) use participants::{
    participant_list_notification, participant_statuses_message, participant_tracks_message,
    reset_room_permissions_for_host, send_participant_list, send_room_participant_list,
    send_room_permissions, ParticipantListNotification,
};
pub(crate) use queue::{Countdown, MediaQueue, QueueItem, Suggestion, MAX_QUEUE_ITEMS};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RoomRole {
    Owner,
    Administrator,
    Guest,
}

pub(crate) fn can_control(room: &Room, client_id: &str, client: &Client) -> bool {
    room.clients.iter().any(|id| id == client_id)
        && client.room_id.as_deref() == Some(room.room_id.as_str())
        && matches!(
            role_of(room, client_id, client),
            RoomRole::Owner | RoomRole::Administrator
        )
}

pub(crate) fn role_of(room: &Room, client_id: &str, client: &Client) -> RoomRole {
    if room.host_id == client_id {
        RoomRole::Owner
    } else if client.supports_room_administrator
        && !client.user_id.is_empty()
        && room.administrator_user_id.as_deref() == Some(client.user_id.as_str())
    {
        RoomRole::Administrator
    } else {
        RoomRole::Guest
    }
}

#[cfg(test)]
mod administrator_tests {
    use super::*;
    use crate::test_helpers::{create_client_with_rx, create_room};

    #[test]
    fn administrator_role_follows_jellyfin_account_across_connections() {
        let mut room = create_room("room", "owner");
        room.clients.extend(["ana-1".into(), "ana-2".into()]);
        room.administrator_user_id = Some("ana".into());
        let (owner, _) = create_client_with_rx("owner", "Owner", true);
        let (mut ana_tab_one, _) = create_client_with_rx("ana", "Ana", true);
        let (mut ana_tab_two, _) = create_client_with_rx("ana", "Ana", true);
        ana_tab_one.supports_room_administrator = true;
        ana_tab_two.supports_room_administrator = true;
        ana_tab_one.room_id = Some("room".into());
        let (bruno, _) = create_client_with_rx("bruno", "Bruno", true);
        assert_eq!(role_of(&room, "owner", &owner), RoomRole::Owner);
        assert_eq!(
            role_of(&room, "ana-1", &ana_tab_one),
            RoomRole::Administrator
        );
        assert_eq!(
            role_of(&room, "ana-2", &ana_tab_two),
            RoomRole::Administrator
        );
        assert_eq!(role_of(&room, "bruno", &bruno), RoomRole::Guest);
        let (legacy_ana, _) = create_client_with_rx("ana", "Ana", true);
        assert_eq!(role_of(&room, "ana-legacy", &legacy_ana), RoomRole::Guest);
        assert!(can_control(&room, "ana-1", &ana_tab_one));
        assert!(!can_control(&room, "ana-legacy", &legacy_ana));
    }
}

pub(crate) fn is_saving(room: &Room) -> bool { room.saving.is_some() }

/// Called while holding the shared state lock, before a room mutation.
pub(crate) fn reject_saving(client_id: &str, target: Option<&str>, state: &crate::types::ServerState) -> bool {
    let current=state.clients.get(client_id).and_then(|c|c.room_id.as_deref());
    let busy=[current,target].into_iter().flatten().any(|id|state.rooms.get(id).is_some_and(is_saving));
    if busy {
        crate::messaging::send_message(state.clients.get(client_id).map(|c|c.sender.clone()),&crate::types::WsMessage{
            msg_type:crate::types::ServerMessageType::Error,room:current.map(str::to_owned),client:Some(client_id.into()),
            payload:Some(serde_json::json!({"code":"ROOM_SAVE_IN_PROGRESS","message":"The room is being saved; try again when it finishes"})),ts:crate::utils::now_ms(),server_ts:Some(crate::utils::now_ms())
        },Some(client_id));
    }
    busy
}
