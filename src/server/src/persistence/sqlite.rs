use super::{
    model::{valid_identity, MAX_SNAPSHOT_BYTES},
    SavedRoom, StorageConfig, StorageError,
};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use std::{fs, fs::OpenOptions};

pub(super) struct Database {
    connection: Connection,
    config: StorageConfig,
}
fn unavailable(_: rusqlite::Error) -> StorageError {
    StorageError::Unavailable
}
fn now_i64(now: u64) -> Result<i64, StorageError> {
    i64::try_from(now).map_err(|_| StorageError::CorruptData)
}
impl Database {
    pub fn open(config: StorageConfig) -> Result<Self, StorageError> {
        if config.per_user_limit == 0 || config.total_limit == 0 {
            return Err(StorageError::InvalidConfig);
        }
        if !config.directory.exists() {
            fs::create_dir_all(&config.directory).map_err(|_| StorageError::Unavailable)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&config.directory, fs::Permissions::from_mode(0o700))
                    .map_err(|_| StorageError::Unavailable)?;
            }
        }
        if fs::symlink_metadata(&config.directory)
            .map_err(|_| StorageError::Unavailable)?
            .file_type()
            .is_symlink()
        {
            return Err(StorageError::InvalidConfig);
        }
        let path = config.directory.join("saved-rooms.sqlite3");
        if fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err(StorageError::InvalidConfig);
        }
        let mut options = OpenOptions::new();
        options.write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options.open(&path).map_err(|_| StorageError::Unavailable)?;
        let mut connection = Connection::open(path).map_err(unavailable)?;
        connection
            .busy_timeout(std::time::Duration::from_secs(3))
            .map_err(unavailable)?;
        let version: u32 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(|_| StorageError::CorruptData)?;
        if version > 1 {
            return Err(StorageError::IncompatibleSchema);
        }
        if version == 0 {
            let tx = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(unavailable)?;
            tx.execute_batch("CREATE TABLE IF NOT EXISTS saved_rooms (id TEXT PRIMARY KEY, owner TEXT NOT NULL, saved_at INTEGER NOT NULL, expires_at INTEGER, data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS saved_rooms_owner ON saved_rooms(owner); PRAGMA user_version=1;").map_err(unavailable)?;
            tx.commit().map_err(unavailable)?;
        }
        connection
            .pragma_update(None, "synchronous", "FULL")
            .map_err(unavailable)?;
        Ok(Self { connection, config })
    }
    fn decode(raw: String, owner: &str, id: Option<&str>) -> Result<SavedRoom, StorageError> {
        if raw.len() > MAX_SNAPSHOT_BYTES {
            return Err(StorageError::CorruptData);
        }
        let snapshot: SavedRoom =
            serde_json::from_str(&raw).map_err(|_| StorageError::CorruptData)?;
        snapshot.validate()?;
        if snapshot.owner_user_id != owner || id.is_some_and(|id| id != snapshot.id) {
            return Err(StorageError::CorruptData);
        }
        Ok(snapshot)
    }
    pub fn list(&mut self, owner: &str, now: u64) -> Result<Vec<SavedRoom>, StorageError> {
        if !valid_identity(owner) {
            return Err(StorageError::CorruptData);
        }
        let mut query=self.connection.prepare("SELECT id, CASE WHEN length(data)<=?3 THEN data ELSE '' END FROM saved_rooms WHERE owner=?1 AND (expires_at IS NULL OR expires_at>?2) ORDER BY saved_at DESC, id LIMIT ?4").map_err(unavailable)?;
        let rows = query
            .query_map(
                params![owner, now_i64(now)?, MAX_SNAPSHOT_BYTES as i64, 1001_i64],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .map_err(unavailable)?;
        let mut result = Vec::new();
        for row in rows {
            let (id, raw) = row.map_err(unavailable)?;
            result.push(Self::decode(raw, owner, Some(&id))?)
        }
        if result.len() > 1000 {
            return Err(StorageError::Capacity);
        }
        Ok(result)
    }
    pub fn get(&mut self, owner: &str, id: &str, now: u64) -> Result<SavedRoom, StorageError> {
        let raw:Option<String>=self.connection.query_row("SELECT CASE WHEN length(data)<=?4 THEN data ELSE '' END FROM saved_rooms WHERE owner=?1 AND id=?2 AND (expires_at IS NULL OR expires_at>?3)",params![owner,id,now_i64(now)?,MAX_SNAPSHOT_BYTES as i64],|row|row.get(0)).optional().map_err(unavailable)?;
        Self::decode(raw.ok_or(StorageError::NotFound)?, owner, Some(id))
    }
    pub fn put(&mut self, mut snapshot: SavedRoom, now: u64) -> Result<(), StorageError> {
        snapshot.saved_at_ms = now;
        snapshot.expires_at_ms = self
            .config
            .retention_ms
            .map(|ms| {
                now.checked_add(ms)
                    .filter(|v| *v <= i64::MAX as u64)
                    .ok_or(StorageError::CorruptData)
            })
            .transpose()?;
        snapshot.validate()?;
        let data = serde_json::to_string(&snapshot).map_err(|_| StorageError::CorruptData)?;
        if data.len() > MAX_SNAPSHOT_BYTES {
            return Err(StorageError::CorruptData);
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(unavailable)?;
        let existing: Option<String> = tx
            .query_row(
                "SELECT owner FROM saved_rooms WHERE id=?1",
                [&snapshot.id],
                |row| row.get(0),
            )
            .optional()
            .map_err(unavailable)?;
        if existing
            .as_ref()
            .is_some_and(|owner| owner != &snapshot.owner_user_id)
        {
            return Err(StorageError::NotFound);
        }
        tx.execute(
            "DELETE FROM saved_rooms WHERE expires_at IS NOT NULL AND expires_at<=?1",
            [now_i64(now)?],
        )
        .map_err(unavailable)?;
        let exists: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM saved_rooms WHERE id=?1)",
                [&snapshot.id],
                |r| r.get(0),
            )
            .map_err(unavailable)?;
        if !exists {
            let (total, own): (u32, u32) = tx
                .query_row(
                    "SELECT COUNT(*), COALESCE(SUM(owner=?1),0) FROM saved_rooms",
                    [&snapshot.owner_user_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .map_err(unavailable)?;
            if total >= self.config.total_limit || own >= self.config.per_user_limit {
                return Err(StorageError::Capacity);
            }
        }
        tx.execute("INSERT INTO saved_rooms(id,owner,saved_at,expires_at,data) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET saved_at=excluded.saved_at,expires_at=excluded.expires_at,data=excluded.data WHERE owner=excluded.owner",params![snapshot.id,snapshot.owner_user_id,now_i64(now)?,snapshot.expires_at_ms.map(|v|v as i64),data]).map_err(unavailable)?;
        tx.commit().map_err(unavailable)
    }
    pub fn delete(&mut self, owner: &str, id: &str) -> Result<(), StorageError> {
        let changed = self
            .connection
            .execute(
                "DELETE FROM saved_rooms WHERE owner=?1 AND id=?2",
                params![owner, id],
            )
            .map_err(unavailable)?;
        if changed == 0 {
            return Err(StorageError::NotFound);
        }
        Ok(())
    }
}
