pub(crate) mod access;
mod close;
mod leave;
mod participants;
mod queue;

#[cfg(test)]
pub(crate) use close::close_room;
pub(crate) use close::close_room_in_state;
pub(crate) use close::close_room_parts;
pub(crate) use leave::handle_disconnect_if;
pub use leave::{handle_disconnect, handle_leave, send_leave_notification};
pub(crate) use leave::{handle_leave_without_transfer, host_changed_message};
pub(crate) use participants::send_room_capabilities;
pub(crate) use participants::send_room_administrator;
pub(crate) use participants::{
    participant_list_notification, participant_statuses_message, participant_tracks_message,
    reset_room_permissions_for_host, send_participant_list, send_room_participant_list,
    send_room_permissions, ParticipantListNotification,
};
pub(crate) use queue::{Countdown, MediaQueue, QueueItem, Suggestion, MAX_QUEUE_ITEMS};
use crate::types::{Client, Room};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RoomRole {
    Owner,
    Administrator,
    Guest,
}

pub(crate) fn role_of(room: &Room, client_id: &str, client: &Client) -> RoomRole {
    if room.host_id == client_id {
        RoomRole::Owner
    } else if !client.user_id.is_empty()
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
        room.administrator_user_id = Some("ana".into());
        let (owner, _) = create_client_with_rx("owner", "Owner", true);
        let (ana_tab_one, _) = create_client_with_rx("ana", "Ana", true);
        let (ana_tab_two, _) = create_client_with_rx("ana", "Ana", true);
        let (bruno, _) = create_client_with_rx("bruno", "Bruno", true);
        assert_eq!(role_of(&room, "owner", &owner), RoomRole::Owner);
        assert_eq!(role_of(&room, "ana-1", &ana_tab_one), RoomRole::Administrator);
        assert_eq!(role_of(&room, "ana-2", &ana_tab_two), RoomRole::Administrator);
        assert_eq!(role_of(&room, "bruno", &bruno), RoomRole::Guest);
    }
}
