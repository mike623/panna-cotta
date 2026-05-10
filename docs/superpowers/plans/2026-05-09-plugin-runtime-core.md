# Plugin Runtime Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the WebSocket plugin runtime enabling Node.js plugins to communicate with Panna Cotta via the Elgato Stream Deck protocol — inbound event handling, outbound message dispatch, process lifecycle, and crash recovery.

**Architecture:** `PluginHost` (inside `AppState`) owns all plugin state. Active profile config lives in `PluginHost.profile_state` as the single in-memory source of truth. Each plugin gets a bounded mpsc channel (256) drained by a WS sender task. Lock contract: never `.await` inside `PluginHost` lock; acquire `PluginHost` before `profile_state` when both needed.

**Tech Stack:** Rust, axum 0.7 + ws feature, `tokio::process` for async process management, `tokio::sync::Mutex`, `libc` killpg (unix), `serde_json` for WS payloads.

**This is Plan 1 of 4.** Plan 2 = manifest parsing + discovery. Plan 3 = built-in JS plugins + execute_command removal. Plan 4 = admin UI.

---

## File Map

**Create:**
- `src/plugin/mod.rs` — PluginHost, PluginState, PluginStatus, spawn/stop/crash recovery
- `src/plugin/ws.rs` — WS upgrade handler (Phase A + B auth)
- `src/events/mod.rs` — module declarations
- `src/events/outbound.rs` — host→plugin message builders
- `src/events/inbound.rs` — plugin→host event dispatcher

**Modify:**
- `Cargo.toml` — add axum ws feature, libc (unix)
- `src/lib.rs` — add `pub mod plugin; pub mod events;`
- `src/server/state.rs` — AppState gains `plugin_host`; `AppState::initialize()` loads profile into `profile_state`; `use_stream_deck_config` / `save_stream_deck_config` / `activate_profile` go through `profile_state`
- `src/server/routes.rs` — add `/ws` route; execute handler tries plugin dispatch before Rust fallback; fix test helpers
- `src/server/mod.rs` — call `state.initialize()` at startup
- `src/commands/system.rs` — `quit_app` triggers graceful plugin shutdown

All paths below are relative to `packages/desktop/src-tauri/`.

---

### Task 1: Add Cargo dependencies

**Files:** `Cargo.toml`

- [ ] **Step 1: Update axum to add ws feature**

Change:
```toml
axum = { version = "0.7", features = ["tokio"] }
```
to:
```toml
axum = { version = "0.7", features = ["tokio", "ws"] }
```

- [ ] **Step 2: Add libc for Unix process group kill**

After `nanoid = "0.4"`, add:
```toml

[target.'cfg(unix)'.dependencies]
libc = "0.2"
```

- [ ] **Step 3: Verify**

```bash
cd packages/desktop/src-tauri && cargo check
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src-tauri/Cargo.toml
git commit -m "chore: add axum ws feature and libc dependency for plugin runtime"
```

---

### Task 2: Define plugin types

**Files:** `src/plugin/mod.rs`, `src/plugin/ws.rs` (stub), `src/events/mod.rs`, `src/events/inbound.rs` (stub), `src/events/outbound.rs` (stub), `src/lib.rs`

- [ ] **Step 1: Write failing tests**

Create `src/plugin/mod.rs`:

```rust
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
```

- [ ] **Step 2: Run failing tests**

```bash
cd packages/desktop/src-tauri && cargo test plugin::tests
```

Expected: compilation error (modules not declared in lib.rs yet).

- [ ] **Step 3: Create stubs and wire modules**

Create `src/plugin/ws.rs`:
```rust
// WebSocket handler — implemented in Task 4
```

Create `src/events/mod.rs`:
```rust
pub mod inbound;
pub mod outbound;
```

Create `src/events/inbound.rs`:
```rust
// Inbound event handlers — implemented in Task 6
```

Create `src/events/outbound.rs`:
```rust
// Outbound message builders — implemented in Task 5
```

Replace `src/lib.rs`:
```rust
pub mod app;
pub mod commands;
pub mod events;
pub mod plugin;
pub mod server;
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd packages/desktop/src-tauri && cargo test plugin::tests
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src-tauri/src/
git commit -m "feat: define PluginHost, PluginState, PluginStatus types"
```

---

### Task 3: Integrate profile_state into AppState

**Files:** `src/server/state.rs`, `src/server/routes.rs` (test helpers), `src/app.rs`

- [ ] **Step 1: Update AppState struct**

In `src/server/state.rs`, replace the `AppState` struct and its impl block:

```rust
pub struct AppState {
    pub config_dir: PathBuf,
    pub port: Mutex<Option<u16>>,
    pub csrf_token: String,
    pub plugin_host: Arc<tokio::sync::Mutex<crate::plugin::PluginHost>>,
}

impl Default for AppState {
    fn default() -> Self { Self::new() }
}

impl AppState {
    pub fn new() -> Self {
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_else(|_| ".".to_string());
        let bytes: [u8; 32] = OsRng.gen();
        let csrf_token: String = bytes.iter().map(|b| format!("{:02x}", b)).collect();
        let config_dir = PathBuf::from(home).join(".panna-cotta");
        let plugin_host = Arc::new(tokio::sync::Mutex::new(
            crate::plugin::PluginHost::new(default_config()),
        ));
        Self { config_dir, port: Mutex::new(None), csrf_token, plugin_host }
    }

    /// Load active profile from disk into plugin_host.profile_state.
    /// Call once at startup after migrate_old_config.
    pub async fn initialize(&self) -> Result<(), String> {
        migrate_old_config(self).await.map_err(|e| e.to_string())?;
        let active = get_active_profile_name(self).await;
        let config = read_profile(self, &active).await;
        // Lock order: PluginHost first, then profile_state
        let host = self.plugin_host.lock().await;
        let mut ps = host.profile_state.lock().await;
        *ps = config;
        Ok(())
    }
}
```

- [ ] **Step 2: Route use_stream_deck_config through profile_state**

Replace `use_stream_deck_config` and `save_stream_deck_config`:

```rust
pub async fn use_stream_deck_config(state: &AppState) -> Result<StreamDeckConfig, String> {
    let host = state.plugin_host.lock().await;
    Ok(host.profile_state.lock().await.clone())
}

pub async fn save_stream_deck_config(
    state: &AppState,
    config: &StreamDeckConfig,
) -> Result<(), String> {
    // Update in-memory first (lock order: PluginHost then profile_state)
    {
        let host = state.plugin_host.lock().await;
        let mut ps = host.profile_state.lock().await;
        *ps = config.clone();
    }
    // Write to disk outside lock
    migrate_old_config(state).await.map_err(|e| e.to_string())?;
    let active = get_active_profile_name(state).await;
    tokio::fs::create_dir_all(state.profiles_dir())
        .await
        .map_err(|e| e.to_string())?;
    let result = write_json_atomic(&profile_json_path(state, &active), config).await;
    if result.is_ok() {
        tracing::info!(profile = %active, "config saved");
    }
    result
}
```

- [ ] **Step 3: Update activate_profile to reload profile_state**

Replace `activate_profile`:

```rust
pub async fn activate_profile(state: &AppState, name: &str) -> Result<(), String> {
    let safe = safe_profile_name(name);
    let json_path = profile_json_path(state, &safe);
    let toml_path = profile_toml_path(state, &safe);
    if !json_path.exists() && !toml_path.exists() {
        return Err(format!("Profile \"{}\" not found", safe));
    }
    set_active_profile_name(state, &safe).await.map_err(|e| e.to_string())?;
    let config = read_profile(state, &safe).await;
    let host = state.plugin_host.lock().await;
    let mut ps = host.profile_state.lock().await;
    *ps = config;
    drop(ps);
    drop(host);
    tracing::info!(profile = %safe, "profile activated");
    Ok(())
}
```

- [ ] **Step 4: Fix temp_state() helper in state.rs tests**

```rust
fn temp_state() -> (AppState, TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let plugin_host = Arc::new(tokio::sync::Mutex::new(
        crate::plugin::PluginHost::new(default_config()),
    ));
    let state = AppState {
        config_dir: dir.path().to_path_buf(),
        port: Mutex::new(None),
        csrf_token: "test_csrf_token_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into(),
        plugin_host,
    };
    (state, dir)
}
```

- [ ] **Step 5: Fix make_state() and state_with_profile() in routes.rs tests**

```rust
fn make_state(csrf: &str) -> Arc<AppState> {
    use std::sync::Mutex;
    let plugin_host = Arc::new(tokio::sync::Mutex::new(
        crate::plugin::PluginHost::new(crate::server::state::default_config()),
    ));
    Arc::new(AppState {
        config_dir: "/tmp/test-panna".into(),
        port: Mutex::new(None),
        csrf_token: csrf.to_string(),
        plugin_host,
    })
}

async fn state_with_profile(csrf: &str, buttons: Vec<crate::server::state::Button>) -> Arc<AppState> {
    let dir = tempfile::tempdir().unwrap();
    let dir_path = dir.keep();
    let profiles_dir = dir_path.join("profiles");
    tokio::fs::create_dir_all(&profiles_dir).await.unwrap();
    let config = crate::server::state::StreamDeckConfig {
        grid: crate::server::state::Grid { rows: 2, cols: 3 },
        buttons: buttons.clone(),
    };
    let json = serde_json::to_string_pretty(&config).unwrap();
    tokio::fs::write(profiles_dir.join("Default.json"), &json).await.unwrap();
    tokio::fs::write(dir_path.join("active-profile"), "Default").await.unwrap();
    let plugin_host = Arc::new(tokio::sync::Mutex::new(
        crate::plugin::PluginHost::new(config),
    ));
    Arc::new(AppState {
        config_dir: dir_path,
        port: std::sync::Mutex::new(None),
        csrf_token: csrf.to_string(),
        plugin_host,
    })
}
```

- [ ] **Step 6: Run all tests**

```bash
cd packages/desktop/src-tauri && cargo test
```

Expected: all existing tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src-tauri/src/
git commit -m "refactor: move profile_state into PluginHost; AppState gains plugin_host + initialize()"
```

---

### Task 4: WebSocket Handler

**Files:** `src/plugin/ws.rs`, `src/server/routes.rs`

- [ ] **Step 1: Write failing tests**

In `src/server/routes.rs` tests, add:

```rust
#[tokio::test]
async fn ws_from_lan_returns_403() {
    let state = make_state("tok");
    let app = create_router(state);
    let req = Request::builder()
        .method("GET").uri("/ws")
        .header("Upgrade", "websocket")
        .header("Connection", "Upgrade")
        .header("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
        .header("Sec-WebSocket-Version", "13")
        .extension(axum::extract::ConnectInfo(lan_addr()))
        .body(Body::empty()).unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), 403);
}

#[tokio::test]
async fn ws_bad_origin_returns_403() {
    let state = make_state("tok");
    let app = create_router(state);
    let req = Request::builder()
        .method("GET").uri("/ws")
        .header("Upgrade", "websocket")
        .header("Connection", "Upgrade")
        .header("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
        .header("Sec-WebSocket-Version", "13")
        .header("Origin", "https://evil.com")
        .extension(axum::extract::ConnectInfo(local_addr()))
        .body(Body::empty()).unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), 403);
}

#[tokio::test]
async fn ws_localhost_no_origin_gets_101() {
    let state = make_state("tok");
    let app = create_router(state);
    let req = Request::builder()
        .method("GET").uri("/ws")
        .header("Upgrade", "websocket")
        .header("Connection", "Upgrade")
        .header("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
        .header("Sec-WebSocket-Version", "13")
        // No Origin header = native process
        .extension(axum::extract::ConnectInfo(local_addr()))
        .body(Body::empty()).unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), 101); // Switching Protocols
}
```

- [ ] **Step 2: Run failing tests**

```bash
cd packages/desktop/src-tauri && cargo test ws_from_lan ws_bad_origin ws_localhost_no_origin
```

Expected: compilation errors (handler not defined, /ws not routed).

- [ ] **Step 3: Implement ws.rs**

Replace `src/plugin/ws.rs`:

```rust
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use futures_util::{SinkExt, StreamExt};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use crate::server::routes::is_localhost_addr;
use crate::server::state::AppState;
use crate::plugin::{PluginStatus, CHANNEL_CAPACITY, PENDING_REGISTRATION_TIMEOUT_SECS, WS_AUTH_TIMEOUT_SECS};

pub async fn ws_upgrade(
    ws: WebSocketUpgrade,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    if !is_localhost_addr(&addr) {
        return StatusCode::FORBIDDEN.into_response();
    }

    let port = state.port.lock().ok().and_then(|g| *g).unwrap_or(0);
    let pi_origin = format!("http://127.0.0.1:{port}");
    let origin = headers.get("Origin")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    // No Origin = native process (plugin). Wrong/non-PI origin = reject.
    if !origin.is_empty() && origin != pi_origin {
        return StatusCode::FORBIDDEN.into_response();
    }

    let is_pi = !origin.is_empty();
    ws.on_upgrade(move |socket| handle_ws(socket, state, is_pi)).into_response()
}

async fn handle_ws(socket: WebSocket, state: Arc<AppState>, is_pi: bool) {
    let auth_timeout = Duration::from_secs(WS_AUTH_TIMEOUT_SECS);
    let (mut ws_sender, mut ws_receiver) = socket.split();

    let first = tokio::time::timeout(auth_timeout, ws_receiver.next()).await;
    let text = match first {
        Ok(Some(Ok(Message::Text(t)))) => t,
        _ => return, // timeout, close, or binary
    };

    let msg: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return,
    };

    let event = msg.get("event").and_then(|v| v.as_str()).unwrap_or("");

    if is_pi && event == "registerPropertyInspector" {
        // PI registration — full impl in Plan 2
        tracing::debug!("PI registration (stub)");
        return;
    }

    if !is_pi && event == "registerPlugin" {
        handle_plugin_registration(msg, ws_sender, ws_receiver, state).await;
    }
}

async fn handle_plugin_registration(
    first_msg: serde_json::Value,
    mut ws_sender: futures_util::stream::SplitSink<WebSocket, Message>,
    mut ws_receiver: futures_util::stream::SplitStream<WebSocket>,
    state: Arc<AppState>,
) {
    let uuid = match first_msg.get("uuid").and_then(|v| v.as_str()) {
        Some(u) => u.to_string(),
        None => return,
    };

    // Validate: uuid must be in pending_registrations and within timeout window
    let valid = {
        let host = state.plugin_host.lock().await;
        let timeout = Duration::from_secs(PENDING_REGISTRATION_TIMEOUT_SECS);
        host.pending_registrations.get(&uuid)
            .map(|&spawn_time| spawn_time.elapsed() < timeout)
            .unwrap_or(false)
    };

    if !valid {
        tracing::warn!(uuid = %uuid, "WS: unknown or expired plugin UUID rejected");
        return;
    }

    let (tx, mut rx) = tokio::sync::mpsc::channel::<serde_json::Value>(CHANNEL_CAPACITY);

    // Register: move from pending to running, set sender, flush pre-reg queue
    let queued: Vec<serde_json::Value> = {
        let mut host = state.plugin_host.lock().await;
        host.pending_registrations.remove(&uuid);
        if let Some(ps) = host.plugins.get_mut(&uuid) {
            ps.sender = Some(tx.clone());
            ps.status = PluginStatus::Running;
            ps.pre_reg_queue.drain(..).collect()
        } else {
            vec![]
        }
    };

    for msg in queued {
        let _ = tx.try_send(msg);
    }

    tracing::info!(uuid = %uuid, "plugin registered via WS");

    // WS sender task
    let sender_uuid = uuid.clone();
    let sender_state = state.clone();
    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            let text = serde_json::to_string(&msg).unwrap_or_default();
            if ws_sender.send(Message::Text(text)).await.is_err() {
                break;
            }
        }
        let mut host = sender_state.plugin_host.lock().await;
        if let Some(ps) = host.plugins.get_mut(&sender_uuid) {
            if ps.status == PluginStatus::Running {
                ps.status = PluginStatus::Starting;
                ps.sender = None;
            }
        }
    });

    // Receive loop
    let recv_uuid = uuid.clone();
    while let Some(Ok(Message::Text(text))) = ws_receiver.next().await {
        if let Ok(msg) = serde_json::from_str::<serde_json::Value>(&text) {
            crate::events::inbound::dispatch(msg, &recv_uuid, &state).await;
        }
    }

    {
        let mut host = state.plugin_host.lock().await;
        if let Some(ps) = host.plugins.get_mut(&uuid) {
            ps.sender = None;
        }
    }
    tracing::info!(uuid = %uuid, "plugin WS disconnected");
}
```

- [ ] **Step 4: Add /ws route**

In `src/server/routes.rs` `create_router`, add to the public Router:
```rust
.route("/ws", get(crate::plugin::ws::ws_upgrade))
```

- [ ] **Step 5: Run tests**

```bash
cd packages/desktop/src-tauri && cargo test
```

Expected: all 3 new WS tests pass; all prior tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src-tauri/src/plugin/ws.rs packages/desktop/src-tauri/src/server/routes.rs
git commit -m "feat: add WebSocket handler with Phase A/B auth for plugin connections"
```

---

### Task 5: Outbound event builders

**Files:** `src/events/outbound.rs`

- [ ] **Step 1: Write tests first** (they will fail until Step 3)

Replace `src/events/outbound.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test] fn key_down_payload_shape() {
        let msg = key_down_with_settings("com.ex.action", "ctx123", &serde_json::json!({}), 0, 5);
        assert_eq!(msg["event"], "keyDown");
        assert_eq!(msg["action"], "com.ex.action");
        assert_eq!(msg["context"], "ctx123");
        assert_eq!(msg["device"], "main");
        assert_eq!(msg["payload"]["coordinates"]["column"], 0);
        assert_eq!(msg["payload"]["coordinates"]["row"], 0);
        assert_eq!(msg["payload"]["isInMultiAction"], false);
    }

    #[test] fn coords_wraps_by_cols() {
        // index 7 with 5 cols: col=2, row=1
        let msg = key_down_with_settings("a", "b", &serde_json::json!({}), 7, 5);
        assert_eq!(msg["payload"]["coordinates"]["column"], 2);
        assert_eq!(msg["payload"]["coordinates"]["row"], 1);
    }

    #[test] fn will_appear_includes_settings() {
        let settings = serde_json::json!({"appName": "Calc"});
        let msg = will_appear("a", "b", &settings, 0, 3);
        assert_eq!(msg["event"], "willAppear");
        assert_eq!(msg["payload"]["settings"]["appName"], "Calc");
    }

    #[test] fn device_did_connect_shape() {
        let msg = device_did_connect(5, 3);
        assert_eq!(msg["event"], "deviceDidConnect");
        assert_eq!(msg["device"], "main");
        assert_eq!(msg["deviceInfo"]["size"]["columns"], 5);
        assert_eq!(msg["deviceInfo"]["size"]["rows"], 3);
    }

    #[test] fn send_to_plugin_shape() {
        let msg = send_to_plugin("ctx1", &serde_json::json!({"x":1}));
        assert_eq!(msg["event"], "sendToPlugin");
        assert_eq!(msg["payload"]["x"], 1);
    }
}
```

- [ ] **Step 2: Run failing tests**

```bash
cd packages/desktop/src-tauri && cargo test events::outbound
```

Expected: compile error.

- [ ] **Step 3: Implement outbound builders**

Replace full file:

```rust
use serde_json::{json, Value};

fn coords(index: usize, cols: u32) -> (u32, u32) {
    ((index as u32) % cols, (index as u32) / cols)
}

fn base(event: &str, action_uuid: &str, context: &str) -> Value {
    json!({ "event": event, "action": action_uuid, "context": context, "device": "main" })
}

pub fn key_down_with_settings(action_uuid: &str, context: &str, settings: &Value, index: usize, cols: u32) -> Value {
    let (col, row) = coords(index, cols);
    let mut m = base("keyDown", action_uuid, context);
    m["payload"] = json!({
        "settings": settings,
        "coordinates": { "column": col, "row": row },
        "state": 0, "isInMultiAction": false
    });
    m
}

pub fn key_up_with_settings(action_uuid: &str, context: &str, settings: &Value, index: usize, cols: u32) -> Value {
    let (col, row) = coords(index, cols);
    let mut m = base("keyUp", action_uuid, context);
    m["payload"] = json!({
        "settings": settings,
        "coordinates": { "column": col, "row": row },
        "state": 0, "isInMultiAction": false
    });
    m
}

pub fn will_appear(action_uuid: &str, context: &str, settings: &Value, index: usize, cols: u32) -> Value {
    let (col, row) = coords(index, cols);
    let mut m = base("willAppear", action_uuid, context);
    m["payload"] = json!({
        "settings": settings,
        "coordinates": { "column": col, "row": row },
        "state": 0, "isInMultiAction": false
    });
    m
}

pub fn will_disappear(action_uuid: &str, context: &str, settings: &Value, index: usize, cols: u32) -> Value {
    let (col, row) = coords(index, cols);
    let mut m = base("willDisappear", action_uuid, context);
    m["payload"] = json!({
        "settings": settings,
        "coordinates": { "column": col, "row": row },
        "state": 0, "isInMultiAction": false
    });
    m
}

pub fn device_did_connect(cols: u32, rows: u32) -> Value {
    json!({
        "event": "deviceDidConnect",
        "device": "main",
        "deviceInfo": {
            "name": "Panna Cotta",
            "type": 0,
            "size": { "columns": cols, "rows": rows }
        }
    })
}

pub fn did_receive_settings(action_uuid: &str, context: &str, settings: &Value) -> Value {
    let mut m = base("didReceiveSettings", action_uuid, context);
    m["payload"] = json!({ "settings": settings, "isInMultiAction": false });
    m
}

pub fn send_to_plugin(context: &str, payload: &Value) -> Value {
    json!({ "event": "sendToPlugin", "context": context, "payload": payload })
}

pub fn send_to_property_inspector(action_uuid: &str, context: &str, payload: &Value) -> Value {
    let mut m = base("sendToPropertyInspector", action_uuid, context);
    m["payload"] = payload.clone();
    m
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test] fn key_down_payload_shape() {
        let msg = key_down_with_settings("com.ex.action", "ctx123", &serde_json::json!({}), 0, 5);
        assert_eq!(msg["event"], "keyDown");
        assert_eq!(msg["action"], "com.ex.action");
        assert_eq!(msg["context"], "ctx123");
        assert_eq!(msg["device"], "main");
        assert_eq!(msg["payload"]["coordinates"]["column"], 0);
        assert_eq!(msg["payload"]["coordinates"]["row"], 0);
        assert_eq!(msg["payload"]["isInMultiAction"], false);
    }

    #[test] fn coords_wraps_by_cols() {
        let msg = key_down_with_settings("a", "b", &serde_json::json!({}), 7, 5);
        assert_eq!(msg["payload"]["coordinates"]["column"], 2);
        assert_eq!(msg["payload"]["coordinates"]["row"], 1);
    }

    #[test] fn will_appear_includes_settings() {
        let settings = serde_json::json!({"appName": "Calc"});
        let msg = will_appear("a", "b", &settings, 0, 3);
        assert_eq!(msg["event"], "willAppear");
        assert_eq!(msg["payload"]["settings"]["appName"], "Calc");
    }

    #[test] fn device_did_connect_shape() {
        let msg = device_did_connect(5, 3);
        assert_eq!(msg["event"], "deviceDidConnect");
        assert_eq!(msg["device"], "main");
        assert_eq!(msg["deviceInfo"]["size"]["columns"], 5);
        assert_eq!(msg["deviceInfo"]["size"]["rows"], 3);
    }

    #[test] fn send_to_plugin_shape() {
        let msg = send_to_plugin("ctx1", &serde_json::json!({"x":1}));
        assert_eq!(msg["event"], "sendToPlugin");
        assert_eq!(msg["payload"]["x"], 1);
    }
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/desktop/src-tauri && cargo test events::outbound
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src-tauri/src/events/outbound.rs
git commit -m "feat: add outbound event builders for host→plugin WS messages"
```

---

### Task 6: Inbound event handlers

**Files:** `src/events/inbound.rs`

- [ ] **Step 1: Write failing tests**

Replace `src/events/inbound.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::state::{AppState, Button, Grid, StreamDeckConfig};
    use std::sync::Arc;

    fn test_state(buttons: Vec<Button>) -> Arc<AppState> {
        let config = StreamDeckConfig { grid: Grid { rows: 2, cols: 3 }, buttons };
        let plugin_host = Arc::new(tokio::sync::Mutex::new(
            crate::plugin::PluginHost::new(config),
        ));
        Arc::new(AppState {
            config_dir: "/tmp/test-inbound".into(),
            port: std::sync::Mutex::new(None),
            csrf_token: "test".into(),
            plugin_host,
        })
    }

    #[tokio::test]
    async fn set_settings_updates_in_memory() {
        let state = test_state(vec![Button {
            name: "T".into(), icon: "x".into(),
            action_uuid: "com.pannacotta.system.open-app".into(),
            context: "ctx001".into(),
            settings: serde_json::json!({"appName": "Calculator"}),
            lan_allowed: None,
        }]);
        dispatch(serde_json::json!({
            "event": "setSettings",
            "context": "ctx001",
            "payload": {"appName": "Terminal"}
        }), "com.pannacotta.system", &state).await;
        let host = state.plugin_host.lock().await;
        let ps = host.profile_state.lock().await;
        let btn = ps.buttons.iter().find(|b| b.context == "ctx001").unwrap();
        assert_eq!(btn.settings["appName"], "Terminal");
    }

    #[tokio::test]
    async fn set_settings_unknown_context_no_panic() {
        let state = test_state(vec![]);
        dispatch(serde_json::json!({
            "event": "setSettings", "context": "unknown", "payload": {}
        }), "com.pannacotta.system", &state).await;
    }

    #[test]
    fn is_unsupported_detects_unknown_events() {
        assert!(!is_unsupported("setSettings"));
        assert!(!is_unsupported("getSettings"));
        assert!(!is_unsupported("openUrl"));
        assert!(!is_unsupported("logMessage"));
        assert!(!is_unsupported("setTitle"));
        assert!(!is_unsupported("showOk"));
        assert!(!is_unsupported("showAlert"));
        assert!(!is_unsupported("sendToPropertyInspector"));
        assert!(!is_unsupported("registerPlugin"));
        assert!(is_unsupported("setImage"));
        assert!(is_unsupported("setState"));
        assert!(is_unsupported("setGlobalSettings"));
        assert!(is_unsupported("unknownFoo"));
    }
}
```

- [ ] **Step 2: Run failing tests**

```bash
cd packages/desktop/src-tauri && cargo test events::inbound
```

Expected: compile error.

- [ ] **Step 3: Implement inbound.rs**

```rust
use std::sync::Arc;
use crate::server::state::AppState;

const SUPPORTED: &[&str] = &[
    "registerPlugin", "registerPropertyInspector",
    "setTitle", "setSettings", "getSettings",
    "showOk", "showAlert", "openUrl", "logMessage",
    "sendToPropertyInspector", "sendToPlugin",
];

pub fn is_unsupported(event: &str) -> bool {
    !SUPPORTED.contains(&event)
}

pub async fn dispatch(msg: serde_json::Value, plugin_uuid: &str, state: &Arc<AppState>) {
    let event = msg.get("event").and_then(|v| v.as_str()).unwrap_or("");
    match event {
        "setSettings"             => on_set_settings(msg, plugin_uuid, state).await,
        "getSettings"             => on_get_settings(msg, plugin_uuid, state).await,
        "setTitle"                => on_set_title(&msg, plugin_uuid),
        "showOk"                  => on_show_ok(&msg, plugin_uuid),
        "showAlert"               => on_show_alert(&msg, plugin_uuid),
        "openUrl"                 => on_open_url(msg, plugin_uuid).await,
        "logMessage"              => on_log_message(&msg, plugin_uuid),
        "sendToPropertyInspector" => on_send_to_pi(&msg, plugin_uuid),
        _ if is_unsupported(event) => record_unsupported(plugin_uuid, event, state).await,
        _ => {}
    }
}

async fn on_set_settings(msg: serde_json::Value, plugin_uuid: &str, state: &Arc<AppState>) {
    let context = match msg.get("context").and_then(|v| v.as_str()) {
        Some(c) => c.to_string(),
        None => return,
    };
    let payload = msg.get("payload").cloned().unwrap_or(serde_json::Value::Null);

    // Lock order: PluginHost → profile_state
    let config_snapshot = {
        let host = state.plugin_host.lock().await;
        let mut ps = host.profile_state.lock().await;
        if let Some(btn) = ps.buttons.iter_mut().find(|b| b.context == context) {
            btn.settings = payload;
        } else {
            tracing::debug!(plugin=%plugin_uuid, ctx=%context, "setSettings: unknown context");
            return;
        }
        ps.clone()
    };

    // Persist outside lock
    let active = crate::server::state::get_active_profile_name(state).await;
    let path = crate::server::state::profile_json_path(state, &active);
    let tmp = path.with_extension("json.tmp");
    let json = match serde_json::to_string_pretty(&config_snapshot) {
        Ok(j) => j,
        Err(e) => {
            tracing::error!(plugin=%plugin_uuid, error=%e, "setSettings: serialize failed");
            mark_not_persisted(plugin_uuid, state).await;
            return;
        }
    };
    if let Err(e) = tokio::fs::create_dir_all(path.parent().unwrap()).await {
        tracing::error!(plugin=%plugin_uuid, error=%e, "setSettings: mkdir failed");
        mark_not_persisted(plugin_uuid, state).await;
        return;
    }
    if tokio::fs::write(&tmp, &json).await.is_err()
        || tokio::fs::rename(&tmp, &path).await.is_err()
    {
        tracing::error!(plugin=%plugin_uuid, "setSettings: disk write failed");
        mark_not_persisted(plugin_uuid, state).await;
        return;
    }
    tracing::info!(plugin=%plugin_uuid, ctx=%context, "setSettings persisted");
}

async fn on_get_settings(msg: serde_json::Value, plugin_uuid: &str, state: &Arc<AppState>) {
    let context = match msg.get("context").and_then(|v| v.as_str()) {
        Some(c) => c.to_string(),
        None => return,
    };
    let (action_uuid, settings) = {
        let host = state.plugin_host.lock().await;
        let ps = host.profile_state.lock().await;
        match ps.buttons.iter().find(|b| b.context == context) {
            Some(btn) => (btn.action_uuid.clone(), btn.settings.clone()),
            None => return,
        }
    };
    let response = crate::events::outbound::did_receive_settings(&action_uuid, &context, &settings);
    let host = state.plugin_host.lock().await;
    host.try_send(plugin_uuid, response);
}

fn on_set_title(msg: &serde_json::Value, plugin_uuid: &str) {
    let ctx = msg.get("context").and_then(|v| v.as_str()).unwrap_or("?");
    let title = msg["payload"]["title"].as_str().unwrap_or("");
    tracing::info!(plugin=%plugin_uuid, ctx=%ctx, title=%title, "setTitle (UI not yet implemented)");
}

fn on_show_ok(msg: &serde_json::Value, plugin_uuid: &str) {
    let ctx = msg.get("context").and_then(|v| v.as_str()).unwrap_or("?");
    tracing::info!(plugin=%plugin_uuid, ctx=%ctx, "showOk");
}

fn on_show_alert(msg: &serde_json::Value, plugin_uuid: &str) {
    let ctx = msg.get("context").and_then(|v| v.as_str()).unwrap_or("?");
    tracing::warn!(plugin=%plugin_uuid, ctx=%ctx, "showAlert");
}

async fn on_open_url(msg: serde_json::Value, plugin_uuid: &str) {
    let url = match msg["payload"]["url"].as_str() {
        Some(u) => u.to_string(),
        None => return,
    };
    if let Err(e) = crate::commands::system::validate_url_scheme(&url) {
        tracing::warn!(plugin=%plugin_uuid, url=%url, error=%e, "openUrl rejected");
        return;
    }
    if let Err(e) = crate::commands::system::open_url(url.clone()).await {
        tracing::warn!(plugin=%plugin_uuid, url=%url, error=%e, "openUrl failed");
    }
}

fn on_log_message(msg: &serde_json::Value, plugin_uuid: &str) {
    let text = msg["payload"]["message"].as_str().unwrap_or("");
    tracing::info!(plugin=%plugin_uuid, "[plugin] {}", text);
}

fn on_send_to_pi(msg: &serde_json::Value, plugin_uuid: &str) {
    let ctx = msg.get("context").and_then(|v| v.as_str()).unwrap_or("?");
    tracing::debug!(plugin=%plugin_uuid, ctx=%ctx, "sendToPropertyInspector (PI routing in Plan 2)");
}

async fn record_unsupported(plugin_uuid: &str, event: &str, state: &Arc<AppState>) {
    let mut host = state.plugin_host.lock().await;
    if let Some(ps) = host.plugins.get_mut(plugin_uuid) {
        let inserted = ps.unsupported_events.insert(event.to_string());
        if inserted {
            tracing::warn!(plugin=%plugin_uuid, event=%event, "unsupported plugin event");
        }
    }
}

async fn mark_not_persisted(plugin_uuid: &str, state: &Arc<AppState>) {
    let mut host = state.plugin_host.lock().await;
    if let Some(ps) = host.plugins.get_mut(plugin_uuid) {
        ps.settings_not_persisted = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::state::{AppState, Button, Grid, StreamDeckConfig};
    use std::sync::Arc;

    fn test_state(buttons: Vec<Button>) -> Arc<AppState> {
        let config = StreamDeckConfig { grid: Grid { rows: 2, cols: 3 }, buttons };
        let plugin_host = Arc::new(tokio::sync::Mutex::new(
            crate::plugin::PluginHost::new(config),
        ));
        Arc::new(AppState {
            config_dir: "/tmp/test-inbound".into(),
            port: std::sync::Mutex::new(None),
            csrf_token: "test".into(),
            plugin_host,
        })
    }

    #[tokio::test]
    async fn set_settings_updates_in_memory() {
        let state = test_state(vec![Button {
            name: "T".into(), icon: "x".into(),
            action_uuid: "com.pannacotta.system.open-app".into(),
            context: "ctx001".into(),
            settings: serde_json::json!({"appName": "Calculator"}),
            lan_allowed: None,
        }]);
        dispatch(serde_json::json!({
            "event": "setSettings",
            "context": "ctx001",
            "payload": {"appName": "Terminal"}
        }), "com.pannacotta.system", &state).await;
        let host = state.plugin_host.lock().await;
        let ps = host.profile_state.lock().await;
        let btn = ps.buttons.iter().find(|b| b.context == "ctx001").unwrap();
        assert_eq!(btn.settings["appName"], "Terminal");
    }

    #[tokio::test]
    async fn set_settings_unknown_context_no_panic() {
        let state = test_state(vec![]);
        dispatch(serde_json::json!({
            "event": "setSettings", "context": "unknown", "payload": {}
        }), "com.pannacotta.system", &state).await;
    }

    #[test]
    fn is_unsupported_detects_unknown_events() {
        assert!(!is_unsupported("setSettings"));
        assert!(!is_unsupported("getSettings"));
        assert!(!is_unsupported("openUrl"));
        assert!(!is_unsupported("logMessage"));
        assert!(!is_unsupported("setTitle"));
        assert!(!is_unsupported("showOk"));
        assert!(!is_unsupported("showAlert"));
        assert!(!is_unsupported("sendToPropertyInspector"));
        assert!(!is_unsupported("registerPlugin"));
        assert!(is_unsupported("setImage"));
        assert!(is_unsupported("setState"));
        assert!(is_unsupported("setGlobalSettings"));
        assert!(is_unsupported("unknownFoo"));
    }
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/desktop/src-tauri && cargo test events::inbound
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src-tauri/src/events/inbound.rs
git commit -m "feat: add inbound event dispatcher for plugin→host WS messages"
```

---

### Task 7: Plugin process lifecycle

**Files:** `src/plugin/mod.rs`

- [ ] **Step 1: Write failing tests**

Add to `plugin/mod.rs` tests:

```rust
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
    assert!(!host.record_crash("p")); // already errored; last call returns false
}

#[tokio::test]
async fn spawn_plugin_adds_to_pending() {
    let mut host = PluginHost::new(default_config());
    // Use a trivial command guaranteed to exist on all platforms
    #[cfg(unix)] let (bin, code) = ("/bin/sh", "-c exit 0");
    #[cfg(windows)] let (bin, code) = ("cmd.exe", "/C exit 0");
    host.spawn_plugin("com.test.p", bin, code, 30000).await.unwrap();
    assert!(host.pending_registrations.contains_key("com.test.p"));
    assert!(host.plugins.contains_key("com.test.p"));
    assert_eq!(host.plugins["com.test.p"].status, PluginStatus::Starting);
}
```

- [ ] **Step 2: Run failing tests**

```bash
cd packages/desktop/src-tauri && cargo test plugin::tests::crash_recovery plugin::tests::spawn
```

Expected: compile error.

- [ ] **Step 3: Implement spawn_plugin, stop_plugin, record_crash, shutdown**

Add to `plugin/mod.rs` (after the impl block for PluginHost that already exists):

```rust
impl PluginHost {
    /// Spawn a Node.js plugin process.
    pub async fn spawn_plugin(
        &mut self,
        uuid: &str,
        node_binary: &str,
        code_path: &str,
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

    /// Stop a plugin: cancel restart, kill process.
    pub async fn stop_plugin(&mut self, uuid: &str) {
        if let Some(ps) = self.plugins.get_mut(uuid) {
            if let Some(h) = ps.restart_handle.take() { h.abort(); }
            ps.status = PluginStatus::Stopped;
            ps.sender = None;
            let child = ps.process.take();
            let pgid = ps.process_group_id;
            // Drop mutable borrow before awaiting
            drop(ps);
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

async fn kill_process(child: Option<tokio::process::Child>, pgid: Option<u32>) {
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
```

Also add `#[cfg(unix)] use libc;` near the top of the file inside a conditional block, or in `lib.rs`. Add to `plugin/mod.rs` top-level:
```rust
#[cfg(unix)]
extern crate libc;
```

- [ ] **Step 4: Run tests**

```bash
cd packages/desktop/src-tauri && cargo test plugin::tests
```

Expected: all tests pass (7 total).

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src-tauri/src/plugin/mod.rs
git commit -m "feat: add plugin process lifecycle (spawn, crash recovery, shutdown)"
```

---

### Task 8: Startup, shutdown, and plugin-aware execute

**Files:** `src/server/mod.rs`, `src/commands/system.rs`, `src/server/routes.rs`

- [ ] **Step 1: Update server/mod.rs to call initialize()**

In `src/server/mod.rs`, replace the `start()` function:

```rust
pub async fn start(state: Arc<AppState>) -> Result<u16, String> {
    // Step 1: migrate + load active profile into PluginHost.profile_state
    state.initialize().await?;

    let port = resolve_port().await?;
    let router = routes::create_router(state.clone());
    let listener = TcpListener::bind(format!("0.0.0.0:{port}"))
        .await
        .map_err(|e| e.to_string())?;

    *state.port.lock().map_err(|e| e.to_string())? = Some(port);
    tracing::info!(port, "server bound");

    tauri::async_runtime::spawn(async move {
        axum::serve(listener, router.into_make_service_with_connect_info::<SocketAddr>())
            .await
            .expect("axum server failed");
    });

    // Plugin discovery + spawn happens in Plan 2.
    tracing::info!("plugin runtime ready");
    Ok(port)
}
```

- [ ] **Step 2: Update quit_app to shut down plugins**

In `src/commands/system.rs`, replace `quit_app`:

```rust
#[tauri::command]
pub async fn quit_app(app: AppHandle) {
    tracing::info!("app quit");
    let state = app.state::<Arc<crate::server::state::AppState>>();
    let cols = {
        let host = state.plugin_host.lock().await;
        host.profile_state.lock().await.grid.cols
    };
    {
        let mut host = state.plugin_host.lock().await;
        host.shutdown(cols).await;
    }
    app.exit(0);
}
```

- [ ] **Step 3: Update execute_handler to try plugin dispatch first**

In `src/server/routes.rs`, in `execute_handler`, replace the block after the `lan_allowed` check with:

```rust
// Try routing through the registered plugin first
let plugin_dispatched = {
    let host = state.plugin_host.lock().await;
    if let Some(plugin_uuid) = host.plugin_for_action(&button.action_uuid).map(|s| s.to_string()) {
        let (index, cols) = {
            let ps = host.profile_state.lock().await;
            let idx = ps.buttons.iter().position(|b| b.context == button.context).unwrap_or(0);
            (idx, ps.grid.cols)
        };
        let msg = crate::events::outbound::key_down_with_settings(
            &button.action_uuid, &button.context, &button.settings, index, cols,
        );
        host.try_send(&plugin_uuid, msg)
    } else {
        false
    }
};

let result = if plugin_dispatched {
    Ok(())
} else {
    // No plugin registered for this action — Rust fallback (removed in Plan 3)
    dispatch_context(&button).await
};
```

- [ ] **Step 4: Run full test suite**

```bash
cd packages/desktop/src-tauri && cargo test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src-tauri/src/server/mod.rs packages/desktop/src-tauri/src/commands/system.rs packages/desktop/src-tauri/src/server/routes.rs
git commit -m "feat: wire plugin runtime into startup, shutdown, and execute dispatch"
```

---

## Spec Coverage

| Requirement | Task |
|---|---|
| PluginHost / PluginState / PluginStatus types | 2 |
| profile_state in PluginHost (single source of truth) | 3 |
| Lock order: PluginHost before profile_state | 3, 6 |
| Never await inside PluginHost lock | 3, 6, 7 |
| Process child take() before kill/wait | 7 |
| AppState.csrf_token unchanged | 3 |
| AppState.initialize() startup sequence | 3, 8 |
| WS Phase A: ConnectInfo localhost check | 4 |
| WS Phase A: Origin check (none=native, PI=PI origin, other=reject) | 4 |
| WS Phase B: UUID + timing auth (10s window) | 4 |
| WS Phase B: 5s auth timeout | 4 |
| pre_reg_queue ≤ 100, overflow dropped | 2 |
| mpsc channel 256, try_send drops on full | 2 |
| keyDown / keyUp / willAppear / willDisappear payloads | 5 |
| deviceDidConnect payload | 5 |
| setSettings: update memory + atomic disk write | 6 |
| setSettings: disk failure → settings_not_persisted | 6 |
| setSettings: unknown context silently ignored | 6 |
| getSettings: didReceiveSettings response | 6 |
| setTitle / showOk / showAlert logged | 6 |
| openUrl: URL-parser scheme validation | 6 |
| logMessage: via tracing | 6 |
| unsupported events: deduplicated per plugin | 6 |
| Crash recovery: 5/60s → errored | 7 |
| Unix: process group / killpg | 7 |
| Startup: migrate → load → server | 8 |
| Shutdown: willDisappear → kill all | 7, 8 |
| Execute: plugin dispatch before Rust fallback | 8 |

**Out of scope for this plan (Plan 2+):**
- Manifest parsing, plugin discovery, Node.js runtime download
- PI token generation and `/pi/*` route (ws.rs has stub)
- sendToPropertyInspector routing to PI
- execute_command Rust fallback removal (Plan 3)
- Admin UI changes (Plan 4)
