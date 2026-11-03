use super::*;
use crate::{persistence::{SavedRoom,SavedQueueItem},types::{Room,ServerState,PlayState,SaveReservation}};

fn capture(room:&Room,owner:&str,id:&str,now:u64)->Result<SavedRoom,StorageError>{
    let position=(room.state.position+if room.state.play_state==PlayState::Playing {now.saturating_sub(room.state_server_ts) as f64/1000.}else{0.}).min(86400.);
    let media_id=room.media_id.clone().ok_or(StorageError::CorruptData)?;
    let title=room.queue.items.iter().find(|i|i.id==media_id).map(|i|i.title.clone()).unwrap_or_else(||room.name.clone());
    let snapshot=SavedRoom{schema_version:1,id:id.into(),owner_user_id:owner.into(),name:room.name.clone(),saved_at_ms:now,expires_at_ms:None,
        media_id,media_title:title,position,items:room.queue.items.iter().map(|i|SavedQueueItem{id:i.id.clone(),title:i.title.clone(),series:i.series.clone()}).collect(),
        last_added:room.queue.last_added.clone(),permissions:room.permissions,access:room.access,
        blocked_users:room.blocked_users.iter().cloned().collect(),admitted_users:room.admitted_users.iter().cloned().collect(),administrator_user_id:room.administrator_user_id.clone()};
    snapshot.validate()?;Ok(snapshot)
}
fn send_playback(room:&Room,clients:&std::collections::HashMap<String,Client>,action:&str){
    let senders=crate::messaging::collect_room_senders(room,clients,None);
    crate::messaging::send_to_senders(&senders,&WsMessage{msg_type:ServerMessageType::PlayerEvent,room:Some(room.room_id.clone()),client:None,
        payload:Some(serde_json::json!({"action":action,"position":room.state.position,"play_state":room.state.play_state,"target_server_ts":now_ms()})),ts:now_ms(),server_ts:Some(now_ms())},"saved session playback");
}
pub(super) async fn handle_save(client_id:&str,ctx:&Context,request:&Request,state:&SharedState,tasks:&crate::tasks::AppTasks){
    let generation=crate::types::next_pending_play_generation();
    let prepared={let mut locked=state.write().await;
        let prepare=|locked:&mut ServerState|->Result<(String,SavedRoom),ErrorCode>{
            let client=locked.clients.get(client_id).filter(|c|still_authorized(ctx,c)).ok_or(ErrorCode::SavedSessionPermissionRequired)?;
            let room_id=client.room_id.clone().ok_or(ErrorCode::NotInRoom)?;
            let room=locked.rooms.get_mut(&room_id).ok_or(ErrorCode::NotInRoom)?;
            if room.host_id!=client_id{return Err(ErrorCode::SavedSessionPermissionRequired)}
            if room.saving.is_some(){return Err(ErrorCode::SavedSessionBusy)}
            let id=room.saved_session_id.as_ref().filter(|_|room.saved_owner_user_id.as_deref()==Some(ctx.user_id.as_str())).cloned().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
            if locked.saved_session_operations.contains_key(&id){return Err(ErrorCode::SavedSessionBusy)}
            let now=now_ms();let snapshot=capture(room,&ctx.user_id,&id,now).map_err(storage_code)?;
            let reservation=SaveReservation{generation,captured_at_ms:now,play_state:room.state.play_state,pending_play:room.pending_play.take(),countdown:room.queue.countdown.take(),countdown_pending:room.countdown_pending,deferred_disconnects:Default::default()};
            room.state.position=snapshot.position;room.state.play_state=PlayState::Paused;room.state_server_ts=now;
            room.saving=Some(reservation);locked.saved_session_operations.insert(id,generation);
            crate::ws::pending_play::send_idle(room,&locked.clients);
            super::super::queue::send_queue_state(room,&locked.clients,None);
            send_playback(room,&locked.clients,"pause");
            Ok((room_id,snapshot))
        };prepare(&mut locked)
    };
    let(room_id,snapshot)=match prepared{Ok(v)=>v,Err(code)=>{failure(client_id,ctx,state,&request.request_id,code).await;return}};
    let id=snapshot.id.clone();let result=ctx.store.put(snapshot,now_ms()).await;
    let mut reconnect=Vec::new();let mut rearm=None;let mut countdown=None;
    {let mut locked=state.write().await;
        if locked.saved_session_operations.get(&id)==Some(&generation){locked.saved_session_operations.remove(&id);}
        let ServerState{clients,rooms,..}=&mut *locked;
        if let Some(room)=rooms.get_mut(&room_id).filter(|r|r.saving.as_ref().is_some_and(|s|s.generation==generation)){
            let reservation=room.saving.take().expect("matching reservation");
            let disconnected=reservation.deferred_disconnects.into_iter().collect::<Vec<_>>();
            if result.is_ok(){
                let senders=crate::room::close_room_parts(&room_id,clients,rooms).unwrap_or_default();
                crate::messaging::send_to_senders(&senders,&WsMessage{msg_type:ServerMessageType::RoomClosed,room:Some(room_id.clone()),client:None,payload:Some(serde_json::json!({"reason":"The Owner saved and closed the room"})),ts:now_ms(),server_ts:Some(now_ms())},"saved room closed");
                for client in disconnected{clients.remove(&client);}
            }else{
                let now=now_ms();room.state.play_state=reservation.play_state;room.state_server_ts=now;room.countdown_pending=reservation.countdown_pending;
                if let Some(mut pending)=reservation.pending_play{
                    let previous=pending.generation;pending.generation=crate::types::next_pending_play_generation();
                    let wait=pending.deadline_server_ts.saturating_sub(reservation.captured_at_ms);pending.deadline_server_ts=now.saturating_add(wait);
                    if room.queue.advance_generation==Some(previous){room.queue.advance_generation=Some(pending.generation)}
                    rearm=Some((pending.generation,wait));room.pending_play=Some(pending);
                }
                if let Some(mut old)=reservation.countdown{let wait=old.until.saturating_sub(reservation.captured_at_ms);old.generation=crate::types::next_pending_play_generation();old.until=now.saturating_add(wait);countdown=Some((old.generation,wait));room.queue.countdown=Some(old);}
                send_playback(room,clients,if room.state.play_state==PlayState::Playing{"play"}else{"pause"});
                super::super::queue::send_queue_state(room,clients,None);
                reconnect=disconnected;
            }
        }
    }
    if let Some((generation,wait))=rearm{std::mem::drop(crate::ws::pending_play::schedule_pending_play(room_id.clone(),generation,wait,state.clone(),tasks));}
    if let Some((generation,wait))=countdown{std::mem::drop(super::super::queue::schedule_countdown(room_id.clone(),generation,std::time::Duration::from_millis(wait),state.clone(),tasks));}
    for client in reconnect{crate::room::handle_disconnect(&client,state,tasks).await;}
    match result{Ok(())=>reply(client_id,ctx,state,ServerMessageType::SavedSessionResult,serde_json::json!({"request_id":request.request_id,"action":"save","id":id})).await,Err(error)=>failure(client_id,ctx,state,&request.request_id,storage_code(error)).await}
    crate::messaging::broadcast_room_list(state).await;
}

#[cfg(test)]
mod tests {
    use super::super::*;
    use super::super::tests::{state,message};
    use crate::{test_helpers,types::{ClientMessageType,PlayState},room::{QueueItem,handle_disconnect}};
    async fn room(state:&SharedState){
        let mut locked=state.write().await;
        let mut room=test_helpers::create_room("room","owner");room.media_id=Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into());room.state.position=123.5;
        room.queue.add(vec![QueueItem{id:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into(),title:"Pilot".into(),series:None}],room.media_id.as_deref());
        locked.clients.get_mut("owner").unwrap().room_id=Some("room".into());locked.rooms.insert("room".into(),room);
    }
    #[tokio::test]
    async fn only_owner_can_save_and_durable_success_closes_everyone(){
        let(state,dir,mut rx)=state().await;room(&state).await;
        {let mut locked=state.write().await;let(mut guest,_)=test_helpers::create_client_with_rx("guest","Guest",true);guest.room_id=Some("room".into());guest.session_expires_at=Some(u64::MAX);guest.supports_persistent_rooms=true;locked.clients.insert("guest".into(),guest);locked.rooms.get_mut("room").unwrap().clients.push("guest".into());}
        let tasks=crate::tasks::AppTasks::new();
        handle_saved_sessions("guest",&message(ClientMessageType::SaveRoomSession,None),&state,&tasks).await;
        assert!(state.read().await.rooms.contains_key("room"));
        handle_saved_sessions("owner",&message(ClientMessageType::SaveRoomSession,None),&state,&tasks).await;
        assert!(!state.read().await.rooms.contains_key("room"));assert!(state.read().await.clients["guest"].room_id.is_none());
        let store=state.read().await.saved_room_store.clone().unwrap();let snapshots=store.list("owner",now_ms()).await.unwrap();assert_eq!(snapshots.len(),1);assert_eq!(snapshots[0].position,123.5);assert_eq!(snapshots[0].items[0].title,"Pilot");
        assert!(std::iter::from_fn(||test_helpers::recv_msg(&mut rx)).any(|m|m.msg_type==ServerMessageType::SavedSessionResult));
        tasks.cancel();tasks.wait().await;store.shutdown().await.unwrap();std::fs::remove_dir_all(dir).unwrap();
    }
    #[tokio::test]
    async fn failed_write_keeps_room_members_queue_and_play_state(){
        let(state,dir,mut rx)=state().await;room(&state).await;
        let store=state.read().await.saved_room_store.clone().unwrap();store.shutdown().await.unwrap();
        {let mut locked=state.write().await;locked.rooms.get_mut("room").unwrap().state.play_state=PlayState::Playing;locked.rooms.get_mut("room").unwrap().state_server_ts=now_ms();}
        let tasks=crate::tasks::AppTasks::new();handle_saved_sessions("owner",&message(ClientMessageType::SaveRoomSession,None),&state,&tasks).await;
        {let locked=state.read().await;let room=&locked.rooms["room"];assert_eq!(room.state.play_state,PlayState::Playing);assert_eq!(room.queue.items.len(),1);assert!(room.saving.is_none());assert_eq!(locked.clients["owner"].room_id.as_deref(),Some("room"));}
        let replies=std::iter::from_fn(||test_helpers::recv_msg(&mut rx)).collect::<Vec<_>>();assert!(!replies.iter().any(|m|m.msg_type==ServerMessageType::RoomClosed));assert!(replies.iter().any(|m|m.msg_type==ServerMessageType::SavedSessionError));
        tasks.cancel();tasks.wait().await;std::fs::remove_dir_all(dir).unwrap();
    }
    #[tokio::test]
    async fn disconnect_and_duplicate_save_do_not_race_checkpoint(){
        let(state,dir,mut rx)=state().await;room(&state).await;let store=state.read().await.saved_room_store.clone().unwrap();let release=store.pause_for_test().await;
        let tasks=crate::tasks::AppTasks::new();let state_copy=state.clone();let task_copy=tasks.clone();
        let save=tokio::spawn(async move{handle_saved_sessions("owner",&message(ClientMessageType::SaveRoomSession,None),&state_copy,&task_copy).await});
        tokio::time::timeout(std::time::Duration::from_secs(2),async{while store.pending_for_test()==0{tokio::task::yield_now().await}}).await.unwrap();
        assert!(state.read().await.rooms["room"].saving.is_some());
        handle_saved_sessions("owner",&message(ClientMessageType::SaveRoomSession,None),&state,&tasks).await;
        assert!(!handle_disconnect("owner",&state,&tasks).await);assert!(state.read().await.rooms.contains_key("room"));
        release.send(()).unwrap();save.await.unwrap();assert!(state.read().await.rooms.is_empty());assert!(!state.read().await.clients.contains_key("owner"));assert_eq!(store.list("owner",now_ms()).await.unwrap().len(),1);
        let _=test_helpers::recv_msg(&mut rx);tasks.cancel();tasks.wait().await;store.shutdown().await.unwrap();std::fs::remove_dir_all(dir).unwrap();
    }
    #[tokio::test]
    async fn queued_commands_and_old_countdown_cannot_cross_save_capture(){
        let(state,dir,mut rx)=state().await;room(&state).await;
        let tasks=crate::tasks::AppTasks::new();let generation=crate::types::next_pending_play_generation();
        {let mut locked=state.write().await;let room=locked.rooms.get_mut("room").unwrap();
            room.queue.add(vec![QueueItem{id:"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".into(),title:"Next".into(),series:None}],room.media_id.as_deref());
            room.queue.countdown=Some(crate::room::Countdown{until:now_ms()+5,generation});
        }
        std::mem::drop(crate::ws::handlers::queue::schedule_countdown("room".into(),generation,std::time::Duration::from_millis(5),state.clone(),&tasks));
        let store=state.read().await.saved_room_store.clone().unwrap();let release=store.pause_for_test().await;
        let copy=state.clone();let taskcopy=tasks.clone();let save=tokio::spawn(async move{handle_saved_sessions("owner",&message(ClientMessageType::SaveRoomSession,None),&copy,&taskcopy).await});
        while store.pending_for_test()==0{tokio::task::yield_now().await}
        let command=crate::types::IncomingMessage{msg_type:ClientMessageType::QueueAdd,room:Some("room".into()),payload:Some(serde_json::json!({"items":[{"id":"cccccccccccccccccccccccccccccccc","title":"Third"}]})),..message(ClientMessageType::QueueAdd,None)};
        crate::ws::handlers::queue::handle_queue("owner",&command,&state,&tasks).await;
        tokio::time::sleep(std::time::Duration::from_millis(15)).await;
        {let locked=state.read().await;assert_eq!(locked.rooms["room"].queue.items.len(),2);assert_eq!(locked.rooms["room"].media_id.as_deref(),Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));}
        release.send(()).unwrap();save.await.unwrap();assert_eq!(store.list("owner",now_ms()).await.unwrap()[0].items.len(),2);
        assert!(std::iter::from_fn(||test_helpers::recv_msg(&mut rx)).any(|m|m.payload.as_ref().is_some_and(|p|p["code"]=="ROOM_SAVE_IN_PROGRESS")));
        tasks.cancel();tasks.wait().await;store.shutdown().await.unwrap();std::fs::remove_dir_all(dir).unwrap();
    }
    #[tokio::test]
    async fn stale_save_result_cannot_close_replacement_room(){
        let(state,dir,_rx)=state().await;room(&state).await;let store=state.read().await.saved_room_store.clone().unwrap();let release=store.pause_for_test().await;
        let tasks=crate::tasks::AppTasks::new();let copy=state.clone();let taskcopy=tasks.clone();
        let save=tokio::spawn(async move{handle_saved_sessions("owner",&message(ClientMessageType::SaveRoomSession,None),&copy,&taskcopy).await});
        while store.pending_for_test()==0{tokio::task::yield_now().await}
        let mut replacement=test_helpers::create_room("room","owner");replacement.name="Replacement".into();state.write().await.rooms.insert("room".into(),replacement);
        release.send(()).unwrap();save.await.unwrap();assert_eq!(state.read().await.rooms["room"].name,"Replacement");
        tasks.cancel();tasks.wait().await;store.shutdown().await.unwrap();std::fs::remove_dir_all(dir).unwrap();
    }
    #[tokio::test]
    async fn administrator_must_inherit_ownership_before_saving(){
        let(state,dir,_rx)=state().await;room(&state).await;
        let(mut admin,mut adminrx)=test_helpers::create_client_with_rx("ana","Ana",true);admin.room_id=Some("room".into());admin.supports_host_transfer=true;admin.supports_room_administrator=true;admin.supports_persistent_rooms=true;admin.session_expires_at=Some(u64::MAX);
        {let mut locked=state.write().await;locked.clients.insert("ana".into(),admin);let room=locked.rooms.get_mut("room").unwrap();room.clients.push("ana".into());room.administrator_user_id=Some("ana".into());}
        let tasks=crate::tasks::AppTasks::new();handle_saved_sessions("ana",&message(ClientMessageType::SaveRoomSession,None),&state,&tasks).await;
        assert_eq!(test_helpers::recv_msg(&mut adminrx).unwrap().payload.unwrap()["code"],"SAVED_SESSION_PERMISSION_REQUIRED");
        {let mut locked=state.write().await;let crate::types::ServerState{clients,rooms,..}=&mut *locked;crate::room::handle_leave("owner",clients,rooms).unwrap();}
        handle_saved_sessions("ana",&message(ClientMessageType::SaveRoomSession,None),&state,&tasks).await;
        let store=state.read().await.saved_room_store.clone().unwrap();assert_eq!(store.list("ana",now_ms()).await.unwrap().len(),1);assert!(store.list("owner",now_ms()).await.unwrap().is_empty());
        tasks.cancel();tasks.wait().await;store.shutdown().await.unwrap();std::fs::remove_dir_all(dir).unwrap();
    }

}
