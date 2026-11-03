//! Private durable sessions. Storage awaits never hold the shared room lock.
use crate::{persistence::{SavedRoomStore, StorageError}, types::{Client, ClientMessageType, IncomingMessage, ServerMessageType, SharedState, WsMessage}, utils::now_ms};
use super::super::dispatch::{send_error,ErrorCode};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request { request_id: String, id: Option<String> }
#[derive(Clone)]
struct Context { user_id: String, authentication_version: u64, store: SavedRoomStore }
fn secure(client:&Client)->bool {
    client.authenticated && !client.user_id.is_empty() && client.supports_persistent_rooms
        && client.session_expires_at.is_some_and(|exp| exp.saturating_mul(1000)>now_ms())
}
async fn context(client_id:&str,state:&SharedState)->Result<Context,ErrorCode>{
    let locked=state.read().await;
    let client=locked.clients.get(client_id).filter(|c|secure(c)).ok_or(ErrorCode::SavedSessionPermissionRequired)?;
    Ok(Context{user_id:client.user_id.clone(),authentication_version:client.authentication_version,
        store:locked.saved_room_store.clone().ok_or(ErrorCode::SavedSessionUnavailable)?})
}
fn still_authorized(context:&Context,client:&Client)->bool {
    secure(client) && client.user_id==context.user_id && client.authentication_version==context.authentication_version
}
async fn reply(client_id:&str,context:&Context,state:&SharedState,kind:ServerMessageType,payload:serde_json::Value){
    let locked=state.read().await;
    if let Some(client)=locked.clients.get(client_id).filter(|c|still_authorized(context,c)) {
        crate::messaging::send_message(Some(client.sender.clone()),&WsMessage{msg_type:kind,room:None,client:Some(client_id.into()),payload:Some(payload),ts:now_ms(),server_ts:Some(now_ms())},Some(client_id));
    }
}
fn storage_code(error:StorageError)->ErrorCode{match error{
    StorageError::Capacity=>ErrorCode::SavedSessionCapacity,StorageError::NotFound=>ErrorCode::SavedSessionNotFound,
    StorageError::Busy=>ErrorCode::SavedSessionBusy,_=>ErrorCode::SavedSessionUnavailable,
}}
fn description(code:ErrorCode)->&'static str{match code{
    ErrorCode::SavedSessionCapacity=>"Saved session limit reached; discard a saved session first",
    ErrorCode::SavedSessionNotFound=>"Saved session not found",
    ErrorCode::SavedSessionBusy=>"This saved session is in progress",
    ErrorCode::InvalidSavedSessionPayload=>"Invalid saved session request",
    ErrorCode::SavedSessionPermissionRequired=>"Only an authenticated compatible account can manage saved sessions",
    ErrorCode::SavedSessionAlreadyInRoom=>"Leave your current room before resuming a saved session",
    _=>"Saved session storage is unavailable",
}}
async fn failure(client_id:&str,context:&Context,state:&SharedState,request_id:&str,code:ErrorCode){
    reply(client_id,context,state,ServerMessageType::SavedSessionError,serde_json::json!({"request_id":request_id,"code":code,"message":description(code)})).await;
}
fn parse(parsed:&IncomingMessage)->Option<Request>{
    let request:Request=serde_json::from_value(parsed.payload.clone()?).ok()?;
    if request.request_id.is_empty() || request.request_id.len()>64 || request.request_id.chars().any(char::is_control){return None}
    let needs_id=matches!(parsed.msg_type,ClientMessageType::DiscardSavedSession|ClientMessageType::ResumeSavedSession);
    if needs_id!=request.id.is_some() || request.id.as_ref().is_some_and(|id|uuid::Uuid::parse_str(id).is_err()){return None}
    Some(request)
}
pub(in crate::ws) async fn handle_saved_sessions(client_id:&str,parsed:&IncomingMessage,state:&SharedState){
    let context=match context(client_id,state).await{Ok(ctx)=>ctx,Err(code)=>{send_error(client_id,state,code,description(code)).await;return}};
    let Some(request)=parse(parsed) else {
        let id=parsed.payload.as_ref().and_then(|p|p.get("request_id")).and_then(|v|v.as_str()).filter(|s|s.len()<=64).unwrap_or("");
        failure(client_id,&context,state,id,ErrorCode::InvalidSavedSessionPayload).await;return;
    };
    match parsed.msg_type {
        ClientMessageType::ListSavedSessions=>{
            match context.store.list(&context.user_id,now_ms()).await {
                Ok(snapshots)=>{
                    let sessions={let locked=state.read().await;snapshots.into_iter().map(|s|{
                        let active=locked.rooms.values().any(|r|r.saved_session_id.as_deref()==Some(s.id.as_str())) || locked.saved_session_operations.contains_key(&s.id);
                        serde_json::json!({"id":s.id,"name":s.name,"media_id":s.media_id,"media_title":s.media_title,"position":s.position,"queue_count":s.items.len(),"saved_at_ms":s.saved_at_ms,"expires_at_ms":s.expires_at_ms,"active":active})
                    }).collect::<Vec<_>>()};
                    reply(client_id,&context,state,ServerMessageType::SavedSessions,serde_json::json!({"request_id":request.request_id,"sessions":sessions})).await;
                },Err(error)=>failure(client_id,&context,state,&request.request_id,storage_code(error)).await,
            }
        },
        ClientMessageType::DiscardSavedSession=>{
            let id=request.id.as_deref().expect("validated id");
            let generation=crate::types::next_pending_play_generation();
            let reserved={let mut locked=state.write().await;
                if !locked.clients.get(client_id).is_some_and(|c|still_authorized(&context,c)){return}
                if locked.saved_session_operations.contains_key(id) || locked.rooms.values().any(|r|r.saved_session_id.as_deref()==Some(id)){false}
                else{locked.saved_session_operations.insert(id.into(),generation);true}
            };
            if !reserved{failure(client_id,&context,state,&request.request_id,ErrorCode::SavedSessionBusy).await;return}
            let result=context.store.delete(&context.user_id,id).await;
            {let mut locked=state.write().await;if locked.saved_session_operations.get(id)==Some(&generation){locked.saved_session_operations.remove(id);}}
            match result{
                Ok(())=>reply(client_id,&context,state,ServerMessageType::SavedSessionResult,serde_json::json!({"request_id":request.request_id,"action":"discard","id":id})).await,
                Err(error)=>failure(client_id,&context,state,&request.request_id,storage_code(error)).await,
            }
        },
        _=>failure(client_id,&context,state,&request.request_id,ErrorCode::SavedSessionUnavailable).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{persistence::{SavedRoomStore,StorageConfig},test_helpers,types::{ClientMessageType,IncomingMessage,ServerMessageType}};
    fn message(kind:ClientMessageType,id:Option<&str>)->IncomingMessage{
        let mut payload=serde_json::json!({"request_id":"request-1"});
        if let Some(id)=id{payload["id"]=id.into()}
        IncomingMessage{msg_type:kind,room:None,client:None,payload:Some(payload),ts:0,server_ts:None}
    }
    async fn state()->(crate::types::SharedState,std::path::PathBuf,tokio::sync::mpsc::Receiver<Result<warp::ws::Message,warp::Error>>){
        let state=test_helpers::create_state();let dir=std::env::temp_dir().join(format!("owp-handler-{}",uuid::Uuid::new_v4()));
        let store=SavedRoomStore::open(StorageConfig{directory:dir.clone(),per_user_limit:20,total_limit:1000,retention_ms:None}).unwrap();
        let(mut client,rx)=test_helpers::create_client_with_rx("owner","Owner",true);client.supports_persistent_rooms=true;client.session_expires_at=Some(u64::MAX);
        {let mut locked=state.write().await;locked.saved_room_store=Some(store);locked.clients.insert("owner".into(),client);}
        (state,dir,rx)
    }
    #[tokio::test]
    async fn authenticated_owner_lists_only_private_checkpoints(){
        let(state,dir,mut rx)=state().await;
        let store=state.read().await.saved_room_store.clone().unwrap();
        store.put(test_helpers::saved_room("owner"),100).await.unwrap();store.put(test_helpers::saved_room("foreign"),100).await.unwrap();
        handle_saved_sessions("owner",&message(ClientMessageType::ListSavedSessions,None),&state).await;
        let reply=test_helpers::recv_msg(&mut rx).unwrap();assert_eq!(reply.msg_type,ServerMessageType::SavedSessions);
        let payload=reply.payload.unwrap();assert_eq!(payload["request_id"],"request-1");assert_eq!(payload["sessions"].as_array().unwrap().len(),1);
        assert!(payload["sessions"][0].get("owner_user_id").is_none());
        store.shutdown().await.unwrap();std::fs::remove_dir_all(dir).unwrap();
    }
    #[tokio::test]
    async fn insecure_legacy_and_unauthenticated_clients_cannot_use_checkpoints(){
        for mode in ["insecure","legacy","unauthenticated"]{
            let(state,dir,mut rx)=state().await;
            {let mut locked=state.write().await;let client=locked.clients.get_mut("owner").unwrap();match mode{"insecure"=>client.session_expires_at=None,"legacy"=>client.supports_persistent_rooms=false,_=>client.authenticated=false}}
            handle_saved_sessions("owner",&message(ClientMessageType::ListSavedSessions,None),&state).await;
            let reply=test_helpers::recv_msg(&mut rx).unwrap();assert_ne!(reply.msg_type,ServerMessageType::SavedSessions);
            state.read().await.saved_room_store.as_ref().unwrap().shutdown().await.unwrap();std::fs::remove_dir_all(dir).unwrap();
        }
    }
    #[tokio::test]
    async fn discard_rejects_foreign_active_and_invalid_requests(){
        let(state,dir,mut rx)=state().await;let store=state.read().await.saved_room_store.clone().unwrap();
        let snapshot=test_helpers::saved_room("foreign");let id=snapshot.id.clone();store.put(snapshot,100).await.unwrap();
        handle_saved_sessions("owner",&message(ClientMessageType::DiscardSavedSession,Some(&id)),&state).await;
        assert_eq!(test_helpers::recv_msg(&mut rx).unwrap().payload.unwrap()["code"],"SAVED_SESSION_NOT_FOUND");
        let snapshot=test_helpers::saved_room("owner");let id=snapshot.id.clone();store.put(snapshot,100).await.unwrap();
        let mut room=test_helpers::create_room("room","owner");room.saved_session_id=Some(id.clone());state.write().await.rooms.insert("room".into(),room);
        handle_saved_sessions("owner",&message(ClientMessageType::DiscardSavedSession,Some(&id)),&state).await;
        assert_eq!(test_helpers::recv_msg(&mut rx).unwrap().payload.unwrap()["code"],"SAVED_SESSION_BUSY");
        state.write().await.rooms.clear();
        let mut invalid=message(ClientMessageType::DiscardSavedSession,Some(&id));invalid.payload.as_mut().unwrap()["extra"]=true.into();
        handle_saved_sessions("owner",&invalid,&state).await;
        assert_eq!(test_helpers::recv_msg(&mut rx).unwrap().payload.unwrap()["code"],"INVALID_SAVED_SESSION_PAYLOAD");
        handle_saved_sessions("owner",&message(ClientMessageType::DiscardSavedSession,Some(&id)),&state).await;
        assert_eq!(test_helpers::recv_msg(&mut rx).unwrap().msg_type,ServerMessageType::SavedSessionResult);
        assert!(store.get("owner",&id,100).await.is_err());store.shutdown().await.unwrap();std::fs::remove_dir_all(dir).unwrap();
    }
    #[tokio::test]
    async fn account_change_during_disk_read_suppresses_stale_reply(){
        let(state,dir,mut rx)=state().await;let store=state.read().await.saved_room_store.clone().unwrap();
        let release=store.pause_for_test().await;
        let state_copy=state.clone();
        let task=tokio::spawn(async move{handle_saved_sessions("owner",&message(ClientMessageType::ListSavedSessions,None),&state_copy).await});
        tokio::time::timeout(std::time::Duration::from_secs(2),async {while store.pending_for_test()==0{tokio::task::yield_now().await}}).await.unwrap();
        {let mut locked=state.write().await;let client=locked.clients.get_mut("owner").unwrap();client.user_id="other".into();client.authentication_version+=1;}
        release.send(()).unwrap();task.await.unwrap();assert!(test_helpers::recv_msg(&mut rx).is_none());
        store.shutdown().await.unwrap();std::fs::remove_dir_all(dir).unwrap();
    }

}
