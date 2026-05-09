pub mod ws;

use std::collections::{HashMap, HashSet, VecDeque};
use std::time::{Duration, Instant};
use std::sync::Arc;
use tokio::process::Child;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::server::state::StreamDeckConfig;

pub const CRASH_WINDOW: Duration = Duration::from_secs(60);
pub const MAX_CRASHES: u32 = 5;
pub const PRE_REG_QUEUE_LIMIT: usize = 100;
pub const PENDING_REGISTRATION_TIMEOUT_SECS: u64 = 10;
pub const WS_AUTH_TIMEOUT_SECS: u64 = 5;
pub const CHANNEL_CAPACITY: usize = 256;

#[derive(Debug, Clone, PartialEq)]
pub enum PluginStatus {
    Starting,
    Running,
    Errored(String),
    Stopped,
}

pub struct PluginState {
    pub process: Option<Child>,
    pub process_group_id: Option<u32>,
    pub sender: Option<mpsc::Sender<serde_json::Value>>,
    pub pre_reg_queue: VecDeque<serde_json::Value>,
    pub restart_handle: Option<JoinHandle<()>>,
    pub status: PluginStatus,
    pub unsupported_events: HashSet<String>,
    pub settings_not_persisted: bool,
    pub crash_count: u32,
    pub last_crash_window_start: Instant,
}

impl PluginState {
    pub fn new() -> Self {
        Self {
            process: None,
            process_group_id: None,
            sender: None,
            pre_reg_queue: VecDeque::new(),
            restart_handle: None,
            status: PluginStatus::Starting,
            unsupported_events: HashSet::new(),
            settings_not_persisted: false,
            crash_count: 0,
            last_crash_window_start: Instant::now(),
        }
    }
}

impl Default for PluginState {
    fn default() -> Self {
        Self::new()
    }
}

pub struct PluginHost {
    pub registry: HashMap<String, String>,         // actionUUID → pluginUUID
    pub plugins: HashMap<String, PluginState>,
    pub pending_registrations: HashMap<String, Instant>, // UUID → spawn time
    pub pi_token_map: HashMap<String, String>,     // PI token → plugin_uuid
    pub profile_state: Arc<tokio::sync::Mutex<StreamDeckConfig>>,
}

impl PluginHost {
    pub fn new(config: StreamDeckConfig) -> Self {
        Self {
            registry: HashMap::new(),
            plugins: HashMap::new(),
            pending_registrations: HashMap::new(),
            pi_token_map: HashMap::new(),
            profile_state: Arc::new(tokio::sync::Mutex::new(config)),
        }
    }

    pub fn plugin_for_action(&self, action_uuid: &str) -> Option<&str> {
        self.registry.get(action_uuid).map(|s| s.as_str())
    }

    pub fn try_send(&self, plugin_uuid: &str, msg: serde_json::Value) -> bool {
        if let Some(state) = self.plugins.get(plugin_uuid) {
            if let Some(sender) = &state.sender {
                return sender.try_send(msg).is_ok();
            }
        }
        false
    }

    /// Queue a message for a plugin that hasn't registered yet.
    /// Drops silently if queue is full (PRE_REG_QUEUE_LIMIT).
    pub fn queue_pre_reg(&mut self, plugin_uuid: &str, msg: serde_json::Value) {
        if let Some(ps) = self.plugins.get_mut(plugin_uuid) {
            if ps.pre_reg_queue.len() < PRE_REG_QUEUE_LIMIT {
                ps.pre_reg_queue.push_back(msg);
            } else {
                tracing::warn!(uuid = %plugin_uuid, "pre_reg_queue full, dropping message");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::state::default_config;

    #[test]
    fn plugin_host_new_is_empty() {
        let host = PluginHost::new(default_config());
        assert!(host.plugins.is_empty());
        assert!(host.registry.is_empty());
        assert!(host.pending_registrations.is_empty());
    }

    #[test]
    fn plugin_for_action_returns_none_when_empty() {
        let host = PluginHost::new(default_config());
        assert!(host.plugin_for_action("com.pannacotta.system.open-app").is_none());
    }

    #[test]
    fn try_send_returns_false_when_no_plugin() {
        let host = PluginHost::new(default_config());
        assert!(!host.try_send("unknown", serde_json::json!({"event":"keyDown"})));
    }

    #[test]
    fn plugin_status_errored_holds_reason() {
        let s = PluginStatus::Errored("crash limit".into());
        assert_eq!(s, PluginStatus::Errored("crash limit".into()));
        assert_ne!(s, PluginStatus::Running);
    }

    #[test]
    fn queue_pre_reg_caps_at_limit() {
        let mut host = PluginHost::new(default_config());
        host.plugins.insert("p1".into(), PluginState::new());
        for _ in 0..=PRE_REG_QUEUE_LIMIT + 5 {
            host.queue_pre_reg("p1", serde_json::json!({}));
        }
        assert_eq!(host.plugins["p1"].pre_reg_queue.len(), PRE_REG_QUEUE_LIMIT);
    }
}
