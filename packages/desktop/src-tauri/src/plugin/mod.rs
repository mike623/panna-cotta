pub mod ws;
pub mod manifest;
pub mod discovery;
pub mod runtime;

#[cfg(unix)]
extern crate libc;

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
    pub manifests: HashMap<String, crate::plugin::manifest::Manifest>,
    pub plugin_dirs: HashMap<String, std::path::PathBuf>,
}

impl PluginHost {
    pub fn new(config: StreamDeckConfig) -> Self {
        Self {
            registry: HashMap::new(),
            plugins: HashMap::new(),
            pending_registrations: HashMap::new(),
            pi_token_map: HashMap::new(),
            profile_state: Arc::new(tokio::sync::Mutex::new(config)),
            manifests: HashMap::new(),
            plugin_dirs: HashMap::new(),
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

impl PluginHost {
    /// Spawn a Node.js plugin process.
    pub async fn spawn_plugin(
        &mut self,
        uuid: &str,
        node_binary: &std::path::Path,
        code_path: &std::path::Path,
        port: u16,
    ) -> Result<(), String> {
        let info = serde_json::json!({
            "application": {"version": "0.x.x"},
            "devices": [{"id": "main", "type": 0, "size": {"columns": 5, "rows": 3}}]
        }).to_string();

        let mut cmd = tokio::process::Command::new(node_binary);
        cmd.arg(code_path)
           .arg("-port").arg(port.to_string())
           .arg("-pluginUUID").arg(uuid)
           .arg("-registerEvent").arg("registerPlugin")
           .arg("-info").arg(&info);

        #[cfg(unix)]
        {
            #[allow(unused_imports)]
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }

        let child = cmd.spawn().map_err(|e| format!("spawn {uuid}: {e}"))?;

        #[cfg(unix)]
        let pgid = child.id();
        #[cfg(not(unix))]
        let pgid: Option<u32> = None;

        let mut ps = PluginState::new();
        ps.process = Some(child);
        #[cfg(unix)] { ps.process_group_id = pgid; }

        self.plugins.insert(uuid.to_string(), ps);
        self.pending_registrations.insert(uuid.to_string(), Instant::now());
        tracing::info!(uuid=%uuid, "plugin spawned");
        Ok(())
    }

    /// Record a crash; returns true if the plugin should be restarted.
    pub fn record_crash(&mut self, uuid: &str) -> bool {
        let ps = match self.plugins.get_mut(uuid) {
            Some(s) => s,
            None => return false,
        };
        if matches!(ps.status, PluginStatus::Errored(_)) {
            return false;
        }
        let now = Instant::now();
        if now.duration_since(ps.last_crash_window_start) > CRASH_WINDOW {
            ps.crash_count = 0;
            ps.last_crash_window_start = now;
        }
        ps.crash_count += 1;
        if ps.crash_count >= MAX_CRASHES {
            ps.status = PluginStatus::Errored(
                format!("{MAX_CRASHES} crashes in {CRASH_WINDOW:?}")
            );
            tracing::error!(uuid=%uuid, "plugin errored: crash limit");
            false
        } else {
            ps.status = PluginStatus::Starting;
            tracing::warn!(uuid=%uuid, crashes=ps.crash_count, "plugin crashed");
            true
        }
    }

    /// Stop a plugin: cancel restart handle, kill process.
    pub async fn stop_plugin(&mut self, uuid: &str) {
        if let Some(ps) = self.plugins.get_mut(uuid) {
            if let Some(h) = ps.restart_handle.take() { h.abort(); }
            ps.status = PluginStatus::Stopped;
            ps.sender = None;
            let child = ps.process.take();
            let pgid = ps.process_group_id;
            let _ = ps; // end mutable borrow before await
            kill_process(child, pgid).await;
        }
        tracing::info!(uuid=%uuid, "plugin stopped");
    }

    /// Graceful shutdown: fire willDisappear for all buttons, then stop all plugins.
    pub async fn shutdown(&mut self, cols: u32) {
        let buttons: Vec<(String, String, serde_json::Value, usize)> = {
            let ps = self.profile_state.lock().await;
            ps.buttons.iter().enumerate()
                .map(|(i, b)| (b.action_uuid.clone(), b.context.clone(), b.settings.clone(), i))
                .collect()
        };
        for (uuid, ctx, settings, idx) in &buttons {
            if let Some(plugin_uuid) = self.registry.get(uuid.as_str()).cloned() {
                let msg = crate::events::outbound::will_disappear(uuid, ctx, settings, *idx, cols);
                self.try_send(&plugin_uuid, msg);
            }
        }
        let uuids: Vec<String> = self.plugins.keys().cloned().collect();
        for uuid in &uuids {
            self.stop_plugin(uuid).await;
        }
        tracing::info!("plugin host shutdown complete");
    }
}

async fn kill_process(child: Option<Child>, pgid: Option<u32>) {
    #[cfg(unix)]
    if let Some(g) = pgid {
        unsafe { libc::killpg(g as libc::pid_t, libc::SIGTERM); }
        tokio::time::sleep(Duration::from_secs(2)).await;
        unsafe { libc::killpg(g as libc::pid_t, libc::SIGKILL); }
    }
    if let Some(mut c) = child {
        let _ = c.kill().await;
        let _ = c.wait().await;
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
    fn plugin_host_has_manifests_and_dirs() {
        let host = PluginHost::new(default_config());
        assert!(host.manifests.is_empty());
        assert!(host.plugin_dirs.is_empty());
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

    #[test]
    fn crash_recovery_increments_count() {
        let mut host = PluginHost::new(default_config());
        host.plugins.insert("p".into(), PluginState::new());
        assert!(host.record_crash("p"));
        assert_eq!(host.plugins["p"].crash_count, 1);
        assert_eq!(host.plugins["p"].status, PluginStatus::Starting);
    }

    #[test]
    fn crash_recovery_errors_at_limit() {
        let mut host = PluginHost::new(default_config());
        host.plugins.insert("p".into(), PluginState::new());
        for _ in 0..MAX_CRASHES {
            host.record_crash("p");
        }
        assert!(matches!(host.plugins["p"].status, PluginStatus::Errored(_)));
        assert!(!host.record_crash("p"));
    }

    #[tokio::test]
    async fn spawn_plugin_adds_to_pending() {
        let mut host = PluginHost::new(default_config());
        #[cfg(unix)] let (bin, code) = (std::path::Path::new("/bin/sh"), std::path::Path::new("-c exit 0"));
        #[cfg(windows)] let (bin, code) = (std::path::Path::new("cmd.exe"), std::path::Path::new("/C exit 0"));
        host.spawn_plugin("com.test.p", bin, code, 30000).await.unwrap();
        assert!(host.pending_registrations.contains_key("com.test.p"));
        assert!(host.plugins.contains_key("com.test.p"));
        assert_eq!(host.plugins["com.test.p"].status, PluginStatus::Starting);
    }
}
