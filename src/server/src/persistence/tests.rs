use super::*;
use std::path::PathBuf;

struct TestDir(PathBuf);
impl TestDir {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("owp-saved-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn config(&self) -> StorageConfig {
        StorageConfig {
            directory: self.0.clone(),
            per_user_limit: 20,
            total_limit: 1000,
            retention_ms: None,
        }
    }
}
impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn saved(owner: &str) -> SavedRoom {
    serde_json::from_value(serde_json::json!({
        "schema_version":1,"id":uuid::Uuid::new_v4().to_string(),"owner_user_id":owner,
        "name":"Series night","saved_at_ms":100,"expires_at_ms":null,
        "media_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","media_title":"Pilot","position":123.5,
        "items":[{"id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","title":"Pilot","series":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}],
        "last_added":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "permissions":{"seek":true,"change_media":false,"edit_queue":true},
        "access":{"approval":true,"unlisted":true},"blocked_users":["blocked"],"admitted_users":["friend"],"administrator_user_id":"ana"
    })).unwrap()
}

#[tokio::test]
async fn checkpoint_survives_reopen() {
    let dir = TestDir::new();
    let store = SavedRoomStore::open(dir.config()).unwrap();
    let snapshot = saved("owner");
    store.put(snapshot.clone(), 100).await.unwrap();
    store.shutdown().await.unwrap();
    let store = SavedRoomStore::open(dir.config()).unwrap();
    let restored = store.get("owner", &snapshot.id, 101).await.unwrap();
    assert_eq!(
        serde_json::to_value(&restored).unwrap(),
        serde_json::to_value(&snapshot).unwrap()
    );
    assert_eq!(store.list("owner", 101).await.unwrap().len(), 1);
    store.shutdown().await.unwrap();
}

#[tokio::test]
async fn foreign_owner_cannot_read_replace_or_delete() {
    let dir = TestDir::new();
    let store = SavedRoomStore::open(dir.config()).unwrap();
    let mut snapshot = saved("owner");
    let id = snapshot.id.clone();
    store.put(snapshot.clone(), 100).await.unwrap();
    assert!(store.list("stranger", 101).await.unwrap().is_empty());
    assert!(matches!(
        store.get("stranger", &id, 101).await,
        Err(StorageError::NotFound)
    ));
    snapshot.owner_user_id = "stranger".into();
    assert!(matches!(
        store.put(snapshot, 101).await,
        Err(StorageError::NotFound)
    ));
    assert!(matches!(
        store.delete("stranger", &id).await,
        Err(StorageError::NotFound)
    ));
    assert_eq!(
        store.get("owner", &id, 102).await.unwrap().owner_user_id,
        "owner"
    );
    store.shutdown().await.unwrap();
}

#[tokio::test]
async fn capacity_rejects_without_eviction() {
    let dir = TestDir::new();
    let mut config = dir.config();
    config.per_user_limit = 1;
    config.total_limit = 2;
    let store = SavedRoomStore::open(config).unwrap();
    let first = saved("owner");
    store.put(first.clone(), 100).await.unwrap();
    assert!(matches!(
        store.put(saved("owner"), 101).await,
        Err(StorageError::Capacity)
    ));
    store.put(saved("other"), 101).await.unwrap();
    assert!(matches!(
        store.put(saved("third"), 101).await,
        Err(StorageError::Capacity)
    ));
    store.put(first.clone(), 102).await.unwrap();
    assert_eq!(store.list("owner", 103).await.unwrap()[0].id, first.id);
    store.shutdown().await.unwrap();
}

#[tokio::test]
async fn expired_rows_are_not_resumed() {
    let dir = TestDir::new();
    let mut config = dir.config();
    config.retention_ms = Some(100);
    let store = SavedRoomStore::open(config).unwrap();
    let snapshot = saved("owner");
    let id = snapshot.id.clone();
    store.put(snapshot, 100).await.unwrap();
    assert_eq!(
        store.get("owner", &id, 199).await.unwrap().expires_at_ms,
        Some(200)
    );
    assert!(store.list("owner", 200).await.unwrap().is_empty());
    assert!(matches!(
        store.get("owner", &id, 200).await,
        Err(StorageError::NotFound)
    ));
    store.shutdown().await.unwrap();
}

#[test]
fn newer_schema_is_not_overwritten() {
    let dir = TestDir::new();
    let path = dir.0.join("saved-rooms.sqlite3");
    let db = rusqlite::Connection::open(&path).unwrap();
    db.pragma_update(None, "user_version", 99).unwrap();
    drop(db);
    assert!(matches!(
        SavedRoomStore::open(dir.config()),
        Err(StorageError::IncompatibleSchema)
    ));
    let db = rusqlite::Connection::open(path).unwrap();
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))
            .unwrap(),
        99
    );
}

#[tokio::test]
async fn corrupt_snapshot_is_rejected() {
    let dir = TestDir::new();
    let store = SavedRoomStore::open(dir.config()).unwrap();
    let snapshot = saved("owner");
    let id = snapshot.id.clone();
    store.put(snapshot, 100).await.unwrap();
    let db = rusqlite::Connection::open(dir.0.join("saved-rooms.sqlite3")).unwrap();
    db.execute("UPDATE saved_rooms SET data='{}' WHERE id=?1", [&id])
        .unwrap();
    assert!(matches!(
        store.get("owner", &id, 101).await,
        Err(StorageError::CorruptData)
    ));
    store.shutdown().await.unwrap();
}

#[tokio::test]
async fn failed_replace_preserves_previous_checkpoint() {
    let dir = TestDir::new();
    let store = SavedRoomStore::open(dir.config()).unwrap();
    let mut snapshot = saved("owner");
    let id = snapshot.id.clone();
    store.put(snapshot.clone(), 100).await.unwrap();
    let db = rusqlite::Connection::open(dir.0.join("saved-rooms.sqlite3")).unwrap();
    db.execute_batch("CREATE TRIGGER reject_update BEFORE UPDATE ON saved_rooms BEGIN SELECT RAISE(ABORT,'injected'); END;").unwrap();
    snapshot.position = 999.;
    assert!(matches!(
        store.put(snapshot, 101).await,
        Err(StorageError::Unavailable)
    ));
    assert_eq!(store.get("owner", &id, 102).await.unwrap().position, 123.5);
    store.shutdown().await.unwrap();
}

#[test]
fn invalid_snapshot_fields_are_rejected() {
    let mut snapshot = saved("owner");
    assert!(snapshot.validate().is_ok());
    snapshot.position = f64::NAN;
    assert!(snapshot.validate().is_err());
    snapshot.position = 0.;
    snapshot.owner_user_id.clear();
    assert!(snapshot.validate().is_err());
    snapshot.owner_user_id = "owner".into();
    snapshot.items = vec![snapshot.items[0].clone(); 21];
    assert!(snapshot.validate().is_err());
}

#[test]
fn configuration_defaults_and_invalid_limits() {
    let read = |key: &str| (key == "PERSISTENT_ROOMS_DIR").then(|| "/tmp/test-only".to_owned());
    let config = StorageConfig::from_values(read).unwrap().unwrap();
    assert_eq!(config.per_user_limit, 20);
    assert_eq!(config.total_limit, 1000);
    assert_eq!(config.retention_ms, None);
    assert!(StorageConfig::from_values(|_| None).unwrap().is_none());
    for (key, value) in [
        ("MAX_SAVED_ROOMS_PER_USER", "0"),
        ("MAX_SAVED_ROOMS", "-1"),
        ("SAVED_ROOMS_RETENTION_DAYS", "18446744073709551615"),
    ] {
        assert!(matches!(
            StorageConfig::from_values(|k| if k == key {
                Some(value.into())
            } else {
                read(k)
            }),
            Err(StorageError::InvalidConfig)
        ));
    }
}

#[tokio::test]
async fn closed_worker_returns_unavailable_instead_of_hanging() {
    let dir = TestDir::new();
    let store = SavedRoomStore::open(dir.config()).unwrap();
    store.shutdown().await.unwrap();
    assert!(matches!(
        store.list("owner", 100).await,
        Err(StorageError::Unavailable)
    ));
}

#[tokio::test]
async fn lowering_capacity_does_not_hide_existing_checkpoints() {
    let dir = TestDir::new();
    let store = SavedRoomStore::open(dir.config()).unwrap();
    store.put(saved("owner"), 100).await.unwrap();
    store.put(saved("owner"), 100).await.unwrap();
    store.shutdown().await.unwrap();
    let mut config = dir.config();
    config.per_user_limit = 1;
    let store = SavedRoomStore::open(config).unwrap();
    assert_eq!(store.list("owner", 101).await.unwrap().len(), 2);
    store.shutdown().await.unwrap();
}
