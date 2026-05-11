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
    pub pi_sender: Option<mpsc::Sender<serde_json::Value>>,
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
            pi_sender: None,
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
    pub plugin_render: Arc<std::sync::Mutex<crate::server::state::PluginRenderState>>,
}

impl PluginHost {
    pub fn new(
        config: StreamDeckConfig,
        plugin_render: Arc<std::sync::Mutex<crate::server::state::PluginRenderState>>,
    ) -> Self {
        Self {
            registry: HashMap::new(),
            plugins: HashMap::new(),
            pending_registrations: HashMap::new(),
            pi_token_map: HashMap::new(),
            profile_state: Arc::new(tokio::sync::Mutex::new(config)),
            manifests: HashMap::new(),
            plugin_dirs: HashMap::new(),
            plugin_render,
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
        plugin_dir: &std::path::Path,
        port: u16,
    ) -> Result<(), String> {
        let info = serde_json::json!({
            "application": {"version": "0.x.x"},
            "devices": [{"id": "main", "type": 0, "size": {"columns": 5, "rows": 3}}]
        }).to_string();

        let mut cmd = tokio::process::Command::new(node_binary);
        cmd.current_dir(plugin_dir)
           .arg(code_path)
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
        // Collect contexts belonging to this plugin and wipe render state
        let contexts: Vec<String> = {
            let ps = self.profile_state.lock().await;
            ps.buttons.iter()
                .filter(|b| self.registry.get(&b.action_uuid).map(|u| u == uuid).unwrap_or(false))
                .map(|b| b.context.clone())
                .collect()
        };
        if let Ok(mut render) = self.plugin_render.lock() {
            render.remove_contexts(&contexts);
        }

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

    /// On profile switch: fire willDisappear for old buttons, update profile_state,
    /// fire willAppear for new buttons.
    /// Call this while holding the PluginHost lock externally — this method takes &mut self.
    pub async fn fire_profile_lifecycle(&mut self, new_cfg: crate::server::state::StreamDeckConfig) {
        // 1. Get old buttons + grid from profile_state (acquire and release immediately)
        let (old_buttons, cols) = {
            let ps = self.profile_state.lock().await;
            (ps.buttons.clone(), ps.grid.cols)
        };

        // 2. Fire willDisappear for old buttons whose contexts are NOT in new cfg
        let new_contexts: std::collections::HashSet<&str> =
            new_cfg.buttons.iter().map(|b| b.context.as_str()).collect();
        for (idx, btn) in old_buttons.iter().enumerate() {
            if !new_contexts.contains(btn.context.as_str()) {
                if let Some(plugin_uuid) = self.registry.get(&btn.action_uuid).cloned() {
                    let msg = crate::events::outbound::will_disappear(
                        &btn.action_uuid, &btn.context, &btn.settings, idx, cols,
                    );
                    self.try_send(&plugin_uuid, msg);
                }
            }
        }

        // 3. Update profile_state
        let new_cols = new_cfg.grid.cols;
        {
            let mut ps = self.profile_state.lock().await;
            *ps = new_cfg.clone();
        }

        // 4. Fire willAppear for new buttons whose contexts were NOT in old cfg
        let old_contexts: std::collections::HashSet<&str> =
            old_buttons.iter().map(|b| b.context.as_str()).collect();
        for (idx, btn) in new_cfg.buttons.iter().enumerate() {
            if !old_contexts.contains(btn.context.as_str()) {
                if let Some(plugin_uuid) = self.registry.get(&btn.action_uuid).cloned() {
                    let msg = crate::events::outbound::will_appear(
                        &btn.action_uuid, &btn.context, &btn.settings, idx, new_cols,
                    );
                    self.try_send(&plugin_uuid, msg);
                }
            }
        }
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
    use crate::server::state::{Button, Grid, StreamDeckConfig, default_config};

    fn make_render() -> Arc<std::sync::Mutex<crate::server::state::PluginRenderState>> {
        Arc::new(std::sync::Mutex::new(crate::server::state::PluginRenderState::default()))
    }

    #[test]
    fn plugin_host_new_is_empty() {
        let host = PluginHost::new(default_config(), make_render());
        assert!(host.plugins.is_empty());
        assert!(host.registry.is_empty());
        assert!(host.pending_registrations.is_empty());
    }

    #[test]
    fn plugin_host_has_manifests_and_dirs() {
        let host = PluginHost::new(default_config(), make_render());
        assert!(host.manifests.is_empty());
        assert!(host.plugin_dirs.is_empty());
    }

    #[test]
    fn plugin_for_action_returns_none_when_empty() {
        let host = PluginHost::new(default_config(), make_render());
        assert!(host.plugin_for_action("com.pannacotta.system.open-app").is_none());
    }

    #[test]
    fn try_send_returns_false_when_no_plugin() {
        let host = PluginHost::new(default_config(), make_render());
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
        let mut host = PluginHost::new(default_config(), make_render());
        host.plugins.insert("p1".into(), PluginState::new());
        for _ in 0..=PRE_REG_QUEUE_LIMIT + 5 {
            host.queue_pre_reg("p1", serde_json::json!({}));
        }
        assert_eq!(host.plugins["p1"].pre_reg_queue.len(), PRE_REG_QUEUE_LIMIT);
    }

    #[test]
    fn crash_recovery_increments_count() {
        let mut host = PluginHost::new(default_config(), make_render());
        host.plugins.insert("p".into(), PluginState::new());
        assert!(host.record_crash("p"));
        assert_eq!(host.plugins["p"].crash_count, 1);
        assert_eq!(host.plugins["p"].status, PluginStatus::Starting);
    }

    #[test]
    fn crash_recovery_errors_at_limit() {
        let mut host = PluginHost::new(default_config(), make_render());
        host.plugins.insert("p".into(), PluginState::new());
        for _ in 0..MAX_CRASHES {
            host.record_crash("p");
        }
        assert!(matches!(host.plugins["p"].status, PluginStatus::Errored(_)));
        assert!(!host.record_crash("p"));
    }

    #[tokio::test]
    async fn spawn_plugin_adds_to_pending() {
        let mut host = PluginHost::new(default_config(), make_render());
        #[cfg(unix)] let (bin, code) = (std::path::Path::new("/bin/sh"), std::path::Path::new("-c exit 0"));
        #[cfg(windows)] let (bin, code) = (std::path::Path::new("cmd.exe"), std::path::Path::new("/C exit 0"));
        let dir = std::env::temp_dir();
        host.spawn_plugin("com.test.p", bin, code, &dir, 30000).await.unwrap();
        assert!(host.pending_registrations.contains_key("com.test.p"));
        assert!(host.plugins.contains_key("com.test.p"));
        assert_eq!(host.plugins["com.test.p"].status, PluginStatus::Starting);
    }

    #[tokio::test]
    async fn switch_profile_fires_will_appear_for_new_buttons() {
        let old_cfg = StreamDeckConfig {
            grid: Grid { rows: 2, cols: 3 },
            buttons: vec![],
        };
        let new_cfg = StreamDeckConfig {
            grid: Grid { rows: 2, cols: 3 },
            buttons: vec![Button {
                name: "Calc".into(), icon: "c".into(),
                action_uuid: "com.pannacotta.system.open-app".into(),
                context: "ctx001".into(),
                settings: serde_json::json!({"appName": "Calculator"}),
                lan_allowed: None,
            }],
        };
        let mut host = PluginHost::new(old_cfg, make_render());
        host.registry.insert("com.pannacotta.system.open-app".into(), "com.pannacotta.system".into());
        let (tx, mut rx) = tokio::sync::mpsc::channel::<serde_json::Value>(32);
        let mut ps = PluginState::new();
        ps.sender = Some(tx);
        ps.status = PluginStatus::Running;
        host.plugins.insert("com.pannacotta.system".into(), ps);

        host.fire_profile_lifecycle(new_cfg).await;

        let msg = rx.try_recv().expect("expected willAppear");
        assert_eq!(msg["event"], "willAppear");
        assert_eq!(msg["context"], "ctx001");
    }

    #[tokio::test]
    async fn switch_profile_fires_will_disappear_for_old_buttons() {
        let old_cfg = StreamDeckConfig {
            grid: Grid { rows: 2, cols: 3 },
            buttons: vec![Button {
                name: "Calc".into(), icon: "c".into(),
                action_uuid: "com.pannacotta.system.open-app".into(),
                context: "ctx001".into(),
                settings: serde_json::json!({}),
                lan_allowed: None,
            }],
        };
        let new_cfg = StreamDeckConfig {
            grid: Grid { rows: 2, cols: 3 },
            buttons: vec![],
        };
        let mut host = PluginHost::new(old_cfg, make_render());
        host.registry.insert("com.pannacotta.system.open-app".into(), "com.pannacotta.system".into());
        let (tx, mut rx) = tokio::sync::mpsc::channel::<serde_json::Value>(32);
        let mut ps = PluginState::new();
        ps.sender = Some(tx);
        ps.status = PluginStatus::Running;
        host.plugins.insert("com.pannacotta.system".into(), ps);

        host.fire_profile_lifecycle(new_cfg).await;

        let msg = rx.try_recv().expect("expected willDisappear");
        assert_eq!(msg["event"], "willDisappear");
        assert_eq!(msg["context"], "ctx001");
    }

    // ── fire_profile_lifecycle: both events on overlapping profiles ──────
    //
    // When switching profiles, buttons unique to the OLD profile should
    // get willDisappear, buttons unique to the NEW profile should get
    // willAppear, and buttons present in BOTH (same context) should get
    // neither (no churn).

    #[tokio::test]
    async fn switch_profile_fires_both_disappear_and_appear_independently() {
        let shared = Button {
            name: "Shared".into(),
            icon: "s".into(),
            action_uuid: "com.pannacotta.system.open-app".into(),
            context: "shared-ctx".into(),
            settings: serde_json::json!({}),
            lan_allowed: None,
        };
        let old_only = Button {
            name: "Old".into(),
            icon: "o".into(),
            action_uuid: "com.pannacotta.system.open-app".into(),
            context: "old-ctx".into(),
            settings: serde_json::json!({}),
            lan_allowed: None,
        };
        let new_only = Button {
            name: "New".into(),
            icon: "n".into(),
            action_uuid: "com.pannacotta.system.open-app".into(),
            context: "new-ctx".into(),
            settings: serde_json::json!({}),
            lan_allowed: None,
        };
        let old_cfg = StreamDeckConfig {
            grid: Grid { rows: 2, cols: 3 },
            buttons: vec![shared.clone(), old_only.clone()],
        };
        let new_cfg = StreamDeckConfig {
            grid: Grid { rows: 2, cols: 3 },
            buttons: vec![shared.clone(), new_only.clone()],
        };

        let mut host = PluginHost::new(old_cfg, make_render());
        host.registry.insert(
            "com.pannacotta.system.open-app".into(),
            "com.pannacotta.system".into(),
        );
        let (tx, mut rx) = tokio::sync::mpsc::channel::<serde_json::Value>(32);
        let mut ps = PluginState::new();
        ps.sender = Some(tx);
        ps.status = PluginStatus::Running;
        host.plugins.insert("com.pannacotta.system".into(), ps);

        host.fire_profile_lifecycle(new_cfg).await;

        // Collect all messages
        let mut events: Vec<(String, String)> = Vec::new();
        while let Ok(msg) = rx.try_recv() {
            let event = msg["event"].as_str().unwrap_or("").to_string();
            let ctx = msg["context"].as_str().unwrap_or("").to_string();
            events.push((event, ctx));
        }

        assert!(
            events.contains(&("willDisappear".to_string(), "old-ctx".to_string())),
            "expected willDisappear for old-only context, got {events:?}"
        );
        assert!(
            events.contains(&("willAppear".to_string(), "new-ctx".to_string())),
            "expected willAppear for new-only context, got {events:?}"
        );
        // Shared context should NOT churn
        assert!(
            !events
                .iter()
                .any(|(_, ctx)| ctx == "shared-ctx"),
            "shared context must not emit lifecycle events, got {events:?}"
        );
    }

    #[tokio::test]
    async fn switch_profile_no_events_when_no_plugin_registered_for_action() {
        // If no plugin is registered for the actionUUID, no events fire
        // (we don't need to crash or panic — just silently no-op).
        let new_cfg = StreamDeckConfig {
            grid: Grid { rows: 1, cols: 1 },
            buttons: vec![Button {
                name: "Orphan".into(),
                icon: "x".into(),
                action_uuid: "com.unknown.plugin.action".into(),
                context: "orphan-ctx".into(),
                settings: serde_json::json!({}),
                lan_allowed: None,
            }],
        };
        let mut host = PluginHost::new(default_config(), make_render());
        // No registry entry, no plugin spawned.
        host.fire_profile_lifecycle(new_cfg).await;
        // Just make sure profile_state still got updated.
        let ps = host.profile_state.lock().await;
        assert_eq!(ps.buttons[0].context, "orphan-ctx");
    }

    // ── stop_plugin clears render state ──────────────────────────────────

    #[tokio::test]
    async fn stop_plugin_clears_render_state_for_owned_contexts() {
        // When a plugin stops, its render state (images/titles/states) for
        // its owned button contexts should be wiped, so the LAN UI doesn't
        // render stale graphics.
        let cfg = StreamDeckConfig {
            grid: Grid { rows: 1, cols: 1 },
            buttons: vec![Button {
                name: "Track".into(),
                icon: "m".into(),
                action_uuid: "com.spotify.sdPlugin.track".into(),
                context: "spotify-ctx".into(),
                settings: serde_json::json!({}),
                lan_allowed: None,
            }],
        };
        let render = make_render();
        // Pre-fill render state for that context
        {
            let mut r = render.lock().unwrap();
            r.images.insert("spotify-ctx".into(), "data:foo".into());
            r.titles.insert("spotify-ctx".into(), "Bohemian Rhapsody".into());
            r.states.insert("spotify-ctx".into(), 1);
            // And a render entry for an unrelated context — must survive
            r.images.insert("other-ctx".into(), "data:bar".into());
        }
        let mut host = PluginHost::new(cfg, Arc::clone(&render));
        host.registry.insert(
            "com.spotify.sdPlugin.track".into(),
            "com.spotify.sdPlugin".into(),
        );
        host.plugins
            .insert("com.spotify.sdPlugin".into(), PluginState::new());

        host.stop_plugin("com.spotify.sdPlugin").await;

        let r = render.lock().unwrap();
        assert!(!r.images.contains_key("spotify-ctx"));
        assert!(!r.titles.contains_key("spotify-ctx"));
        assert!(!r.states.contains_key("spotify-ctx"));
        // Other plugin's render state preserved
        assert!(r.images.contains_key("other-ctx"));
    }

    #[tokio::test]
    async fn stop_plugin_sets_status_to_stopped() {
        let mut host = PluginHost::new(default_config(), make_render());
        host.plugins.insert("p1".into(), PluginState::new());
        host.stop_plugin("p1").await;
        assert_eq!(host.plugins["p1"].status, PluginStatus::Stopped);
    }

    #[tokio::test]
    async fn stop_plugin_unknown_uuid_is_noop() {
        let mut host = PluginHost::new(default_config(), make_render());
        // Should not panic
        host.stop_plugin("does.not.exist").await;
    }

    // ── try_send semantics ────────────────────────────────────────────────

    #[test]
    fn try_send_returns_true_when_channel_open() {
        let mut host = PluginHost::new(default_config(), make_render());
        let (tx, _rx) = tokio::sync::mpsc::channel::<serde_json::Value>(8);
        let mut ps = PluginState::new();
        ps.sender = Some(tx);
        host.plugins.insert("p".into(), ps);
        assert!(host.try_send("p", serde_json::json!({"event": "test"})));
    }

    #[test]
    fn try_send_returns_false_when_no_sender() {
        let mut host = PluginHost::new(default_config(), make_render());
        host.plugins.insert("p".into(), PluginState::new()); // no sender
        assert!(!host.try_send("p", serde_json::json!({"event": "test"})));
    }

    #[test]
    fn crash_window_resets_after_expiry() {
        // After CRASH_WINDOW elapses, crash_count starts over. We simulate
        // this by manually rewinding last_crash_window_start.
        let mut host = PluginHost::new(default_config(), make_render());
        host.plugins.insert("p".into(), PluginState::new());
        // First crash
        host.record_crash("p");
        assert_eq!(host.plugins["p"].crash_count, 1);
        // Rewind the window to just past the boundary
        host.plugins.get_mut("p").unwrap().last_crash_window_start =
            std::time::Instant::now() - CRASH_WINDOW - std::time::Duration::from_secs(1);
        // Next crash should reset to count=1, not increment to 2.
        host.record_crash("p");
        assert_eq!(
            host.plugins["p"].crash_count, 1,
            "crash counter should reset after window expires"
        );
    }
}
