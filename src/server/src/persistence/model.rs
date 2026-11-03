use super::StorageError;
use crate::types::{RoomAccess, RoomPermissions};
use serde::{Deserialize, Serialize};

pub const SNAPSHOT_VERSION: u32 = 1;
pub const MAX_SNAPSHOT_BYTES: usize = 262_144;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SavedQueueItem {
    pub id: String,
    pub title: String,
    pub series: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SavedRoom {
    pub schema_version: u32,
    pub id: String,
    pub owner_user_id: String,
    pub name: String,
    pub saved_at_ms: u64,
    pub expires_at_ms: Option<u64>,
    pub media_id: String,
    pub media_title: String,
    pub position: f64,
    pub items: Vec<SavedQueueItem>,
    pub last_added: Option<String>,
    pub permissions: RoomPermissions,
    pub access: RoomAccess,
    pub blocked_users: Vec<String>,
    pub admitted_users: Vec<String>,
    pub administrator_user_id: Option<String>,
}

pub fn valid_identity(value: &str) -> bool {
    !value.is_empty() && value.len() <= 128 && !value.chars().any(char::is_control)
}
fn valid_text(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.chars().count() <= max && !value.chars().any(char::is_control)
}
fn media_id(value: &str) -> bool {
    value.len() == 32 && value.bytes().all(|c| c.is_ascii_hexdigit())
}
impl SavedRoom {
    pub fn validate(&self) -> Result<(), StorageError> {
        let unique = self
            .items
            .iter()
            .map(|item| &item.id)
            .collect::<std::collections::HashSet<_>>();
        let valid_accounts =
            |values: &[String]| values.len() <= 1000 && values.iter().all(|v| valid_identity(v));
        if self.schema_version != SNAPSHOT_VERSION
            || uuid::Uuid::parse_str(&self.id).is_err()
            || !valid_identity(&self.owner_user_id)
            || !valid_text(&self.name, 128)
            || !valid_text(&self.media_title, 256)
            || !media_id(&self.media_id)
            || !self.position.is_finite()
            || !(0.0..=86400.).contains(&self.position)
            || self.saved_at_ms > i64::MAX as u64
            || self
                .expires_at_ms
                .is_some_and(|v| v > i64::MAX as u64 || v <= self.saved_at_ms)
            || self.items.len() > 20
            || unique.len() != self.items.len()
            || self.items.iter().any(|item| {
                !media_id(&item.id)
                    || !valid_text(&item.title, 256)
                    || item.series.as_ref().is_some_and(|id| !media_id(id))
            })
            || self.last_added.as_ref().is_some_and(|id| !media_id(id))
            || !valid_accounts(&self.blocked_users)
            || !valid_accounts(&self.admitted_users)
            || self
                .administrator_user_id
                .as_ref()
                .is_some_and(|id| !valid_identity(id) || id == &self.owner_user_id)
        {
            return Err(StorageError::CorruptData);
        }
        Ok(())
    }
}
