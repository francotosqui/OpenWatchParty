//! Account-private room checkpoints. SQLite is owned by one blocking worker.
mod model;
mod sqlite;
pub use model::{SavedQueueItem, SavedRoom};
use std::path::PathBuf;
use tokio::sync::{mpsc, oneshot};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StorageError {
    Capacity,
    NotFound,
    Unavailable,
    CorruptData,
    IncompatibleSchema,
    InvalidConfig,
    Busy,
}
impl std::fmt::Display for StorageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{}",
            match self {
                Self::Capacity => "Saved session capacity reached",
                Self::NotFound => "Saved session not found",
                Self::Unavailable => "Saved session storage unavailable",
                Self::CorruptData => "Invalid saved session data",
                Self::IncompatibleSchema =>
                    "Saved session database schema is newer than this server",
                Self::InvalidConfig => "Invalid persistent room configuration",
                Self::Busy => "Saved session storage is busy",
            }
        )
    }
}
impl std::error::Error for StorageError {}

#[derive(Debug, Clone)]
pub struct StorageConfig {
    pub directory: PathBuf,
    pub per_user_limit: u32,
    pub total_limit: u32,
    pub retention_ms: Option<u64>,
}
impl StorageConfig {
    pub fn from_env() -> Result<Option<Self>, StorageError> {
        Self::from_values(|key| std::env::var(key).ok())
    }
    fn from_values(read: impl Fn(&str) -> Option<String>) -> Result<Option<Self>, StorageError> {
        let Some(directory) = read("PERSISTENT_ROOMS_DIR").filter(|s| !s.is_empty()) else {
            return Ok(None);
        };
        let number = |key, default: u64| {
            read(key)
                .map(|v| v.parse::<u64>().map_err(|_| StorageError::InvalidConfig))
                .unwrap_or(Ok(default))
        };
        let per_user = number("MAX_SAVED_ROOMS_PER_USER", 20)?;
        let total = number("MAX_SAVED_ROOMS", 1000)?;
        let days = number("SAVED_ROOMS_RETENTION_DAYS", 0)?;
        if per_user == 0 || total == 0 || per_user > 1000 || total > 100_000 {
            return Err(StorageError::InvalidConfig);
        }
        let ms = days
            .checked_mul(86_400_000)
            .filter(|v| *v <= i64::MAX as u64)
            .ok_or(StorageError::InvalidConfig)?;
        Ok(Some(Self {
            directory: PathBuf::from(directory),
            per_user_limit: per_user as u32,
            total_limit: total as u32,
            retention_ms: (ms > 0).then_some(ms),
        }))
    }
}

type Operation = Box<dyn FnOnce(&mut sqlite::Database) + Send>;
enum Job {
    Run(Operation),
    Stop(oneshot::Sender<()>),
}
#[derive(Debug, Clone)]
pub struct SavedRoomStore {
    sender: mpsc::Sender<Job>,
}
impl SavedRoomStore {
    /// Synchronous startup only. Call through spawn_blocking when already in an async runtime.
    pub fn open(config: StorageConfig) -> Result<Self, StorageError> {
        let (sender, mut receiver) = mpsc::channel::<Job>(32);
        let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);
        std::thread::Builder::new()
            .name("owp-saved-rooms".into())
            .spawn(move || {
                let mut db = match sqlite::Database::open(config) {
                    Ok(db) => {
                        let _ = ready_tx.send(Ok(()));
                        db
                    }
                    Err(error) => {
                        let _ = ready_tx.send(Err(error));
                        return;
                    }
                };
                while let Some(job) = receiver.blocking_recv() {
                    match job {
                        Job::Run(op) => op(&mut db),
                        Job::Stop(done) => {
                            drop(db);
                            let _ = done.send(());
                            return;
                        }
                    }
                }
            })
            .map_err(|_| StorageError::Unavailable)?;
        ready_rx.recv().map_err(|_| StorageError::Unavailable)??;
        Ok(Self { sender })
    }
    async fn call<T: Send + 'static>(
        &self,
        op: impl FnOnce(&mut sqlite::Database) -> Result<T, StorageError> + Send + 'static,
    ) -> Result<T, StorageError> {
        let (reply, rx) = oneshot::channel();
        self.sender
            .try_send(Job::Run(Box::new(move |db| {
                let _ = reply.send(op(db));
            })))
            .map_err(|e| match e {
                mpsc::error::TrySendError::Full(_) => StorageError::Busy,
                _ => StorageError::Unavailable,
            })?;
        rx.await.map_err(|_| StorageError::Unavailable)?
    }
    pub async fn list(&self, owner: &str, now: u64) -> Result<Vec<SavedRoom>, StorageError> {
        let owner = owner.to_owned();
        self.call(move |db| db.list(&owner, now)).await
    }
    pub async fn get(&self, owner: &str, id: &str, now: u64) -> Result<SavedRoom, StorageError> {
        let owner = owner.to_owned();
        let id = id.to_owned();
        self.call(move |db| db.get(&owner, &id, now)).await
    }
    pub async fn put(&self, snapshot: SavedRoom, now: u64) -> Result<(), StorageError> {
        self.call(move |db| db.put(snapshot, now)).await
    }
    pub async fn delete(&self, owner: &str, id: &str) -> Result<(), StorageError> {
        let owner = owner.to_owned();
        let id = id.to_owned();
        self.call(move |db| db.delete(&owner, &id)).await
    }
    pub async fn shutdown(&self) -> Result<(), StorageError> {
        let (tx, rx) = oneshot::channel();
        self.sender
            .send(Job::Stop(tx))
            .await
            .map_err(|_| StorageError::Unavailable)?;
        rx.await.map_err(|_| StorageError::Unavailable)
    }
}
#[cfg(test)]
mod tests;
