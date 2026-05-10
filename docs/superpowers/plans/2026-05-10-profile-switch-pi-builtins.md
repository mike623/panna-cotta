# Plan 3 of 4: Profile Switch Lifecycle + PI + Built-in Plugins

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up profile-switch lifecycle events to the plugin WS layer, implement Property Inspector route + auth, create built-in system/browser plugins (macOS-first, no npm deps), copy them to `~/.panna-cotta/plugins/` at startup, and remove the `execute_command` Rust fallback.

**Branch:** `feat/plugin-runtime-core` (continue on this branch)

**This is Plan 3 of 4.** Plans 1+2 complete (PR #17). Plan 4 = admin UI.

**Tech Stack:** Rust (axum 0.7, tokio), Node.js plain JS (no npm deps), existing deps only.

**Related spec:** `docs/superpowers/specs/2026-05-04-plugin-system-design.md`

---

## Context (read before any task)

### What Plans 1+2 built

- `src/plugin/mod.rs` — `PluginHost` with `spawn_plugin`, `stop_plugin`, `record_crash`, `shutdown`; `PluginState`; `PluginStatus`
- `src/plugin/ws.rs` — WS upgrade (Phase A+B auth), `handle_plugin_registration` (fires `deviceDidConnect` + `willAppear` at registration)
- `src/plugin/manifest.rs` — `Manifest`, `Action`, `validate()`
- `src/plugin/discovery.rs` — `scan_plugins()`, `DiscoveredPlugin`, `PluginSource`
- `src/plugin/runtime.rs` — `resolve_node_binary()`, `check_node_version()`
- `src/events/outbound.rs` — `key_down_with_settings`, `key_up_with_settings`, `will_appear`, `will_disappear`, `device_did_connect`, `did_receive_settings`, `send_to_plugin`, `send_to_property_inspector`
- `src/events/inbound.rs` — `dispatch()` handles: `setSettings`, `getSettings`, `setTitle`, `showOk`, `showAlert`, `openUrl`, `logMessage`, `sendToPropertyInspector` (stub); `sendToPlugin` stub
- `src/server/state.rs` — `AppState { config_dir, port, csrf_token, plugin_host }`, `PluginHost` has `registry: HashMap<String, String>` (actionUUID→pluginUUID), `profile_state: Arc<tokio::sync::Mutex<StreamDeckConfig>>`, `pi_token_map: HashMap<String,String>`
- `src/server/routes.rs` — execute handler tries plugin dispatch (`host.try_send(plugin_uuid, keyDown)`) then falls back to `dispatch_context()` (Rust impl); admin CSRF middleware; `/api/plugins`, `/api/plugins/:uuid/status` routes
- `src/server/mod.rs` — `post_start_spawn()` discovers plugins, registers manifests into `PluginHost.manifests`, spawns processes

### Key gaps this plan fixes

1. `activate_profile` (state.rs:343) updates `profile_state` but does NOT fire lifecycle events
2. `registerPropertyInspector` in ws.rs (line 74-78) is a stub — `tracing::debug!("PI registration stub"); return;`
3. No `/pi/{uuid}/{path}` route exists in routes.rs
4. No built-in plugin source files exist (`src-tauri/plugins/` dir doesn't exist)
5. `sendToPropertyInspector` in inbound.rs just logs; `sendToPlugin` also just logs
6. `execute_command` Rust function still exists and is used as fallback in `dispatch_context()`
7. Dead code in app.js: `executeAction(action, target)` and `openUrl` methods (LAN frontend already uses `{context}` correctly at line 95)

### Locking contract (strict — never violate)

1. Never `.await` inside `PluginHost` lock
2. `try_send` is sync — safe inside lock
3. If both locks needed: acquire `PluginHost` first, clone profile_state Arc, release PluginHost, then acquire profile_state
4. Disk I/O always outside PluginHost lock
5. `profile_state` uses `tokio::sync::Mutex` — can hold across async I/O

### File locations (all relative to `packages/desktop/src-tauri/`)

```
src/
  plugin/mod.rs      (PluginHost)
  plugin/ws.rs       (WS handler)
  plugin/manifest.rs (Manifest types)
  plugin/runtime.rs  (node resolution)
  events/inbound.rs  (plugin→host)
  events/outbound.rs (host→plugin)
  server/state.rs    (AppState, profile ops)
  server/routes.rs   (HTTP handlers)
  server/mod.rs      (startup)
  app.rs             (Tauri builder, command registration)
  commands/system.rs (execute_command, open_app, open_url)
plugins/             (built-in .sdPlugin dirs — CREATE THIS)
  com.pannacotta.system.sdPlugin/
    manifest.json
    bin/plugin.js
  com.pannacotta.browser.sdPlugin/
    manifest.json
    bin/plugin.js
```

Frontend: `packages/frontend/app.js`

---

## Task 1: Profile Switch Lifecycle

**Files:** `src/plugin/mod.rs`, `src/server/state.rs`

**Goal:** When a profile is activated, fire `willDisappear` for buttons leaving active plugins, update `profile_state`, then fire `willAppear` for buttons arriving in active plugins.

### Step 1: Write failing tests

Add to `plugin/mod.rs` test block:

```rust
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
    let mut host = PluginHost::new(old_cfg);
    // Register a fake plugin for this action
    host.registry.insert("com.pannacotta.system.open-app".into(), "com.pannacotta.system".into());
    let (tx, mut rx) = tokio::sync::mpsc::channel::<serde_json::Value>(32);
    let mut ps = PluginState::new();
    ps.sender = Some(tx);
    ps.status = PluginStatus::Running;
    host.plugins.insert("com.pannacotta.system".into(), ps);

    host.fire_profile_lifecycle(new_cfg).await;

    // Should have received willAppear
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
        buttons: vec![], // button gone
    };
    let mut host = PluginHost::new(old_cfg);
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
```

Tests need these imports in the test mod:
```rust
use crate::server::state::{Button, Grid, StreamDeckConfig};
```

### Step 2: Run to confirm failure

```bash
cd packages/desktop/src-tauri && cargo test switch_profile 2>&1 | grep -E "error|FAILED"
```

Expected: compile error — `fire_profile_lifecycle` doesn't exist.

### Step 3: Add `fire_profile_lifecycle` to PluginHost

Add this method to the second `impl PluginHost` block in `plugin/mod.rs`:

```rust
/// On profile switch: fire willDisappear for old buttons, update profile_state,
/// fire willAppear for new buttons.
/// Must be called with PluginHost NOT locked (this method acquires it internally).
pub async fn fire_profile_lifecycle(&mut self, new_cfg: crate::server::state::StreamDeckConfig) {
    // 1. Get old buttons + grid from profile_state
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
```

### Step 4: Update `activate_profile` in state.rs

Replace the current `activate_profile` function:

```rust
pub async fn activate_profile(state: &AppState, name: &str) -> Result<(), String> {
    let safe = safe_profile_name(name);
    let json_path = profile_json_path(state, &safe);
    let toml_path = profile_toml_path(state, &safe);
    if !json_path.exists() && !toml_path.exists() {
        return Err(format!("Profile \"{}\" not found", safe));
    }
    set_active_profile_name(state, &safe).await.map_err(|e| e.to_string())?;
    let new_config = read_profile(state, &safe).await;
    // Fire lifecycle events through PluginHost
    let mut host = state.plugin_host.lock().await;
    host.fire_profile_lifecycle(new_config).await;
    tracing::info!(profile = %safe, "profile activated");
    Ok(())
}
```

### Step 5: Run all tests

```bash
cd packages/desktop/src-tauri && cargo test 2>&1 | grep -E "FAILED|ok$|error\["
```

Expected: all pass including the 2 new lifecycle tests.

### Step 6: Commit

```bash
git add packages/desktop/src-tauri/src/plugin/mod.rs \
        packages/desktop/src-tauri/src/server/state.rs
git commit -m "feat: fire willDisappear/willAppear on profile switch via PluginHost.fire_profile_lifecycle"
```

---

## Task 2: PI Route + Token Generation

**Files:** `src/server/routes.rs`, `src/plugin/mod.rs`

**Goal:** Serve plugin Property Inspector HTML from `/pi/{uuid}/{path}` (localhost-only, no CSRF). On HTML responses, generate a 32-byte hex PI token, inject the bridge script before `</body>`, and store the token in `PluginHost.pi_token_map`.

### Step 1: Write failing tests

Add to `routes.rs` test block:

```rust
#[tokio::test]
async fn pi_route_from_lan_returns_403() {
    let state = make_state("tok");
    let app = create_router(state);
    let req = Request::builder()
        .method("GET")
        .uri("/pi/com.test.plugin/pi.html")
        .extension(axum::extract::ConnectInfo(lan_addr()))
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), 403);
}

#[tokio::test]
async fn pi_route_unknown_plugin_returns_404() {
    let state = make_state("tok");
    let app = create_router(state);
    let req = Request::builder()
        .method("GET")
        .uri("/pi/com.unknown.plugin/pi.html")
        .extension(axum::extract::ConnectInfo(local_addr()))
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), 404);
}
```

### Step 2: Run to confirm failure

```bash
cd packages/desktop/src-tauri && cargo test pi_route 2>&1 | grep -E "error|FAILED"
```

Expected: compile error — no `/pi/` route.

### Step 3: Add PI file-serving handler to routes.rs

Add after the existing imports:

```rust
use axum::http::header::CONTENT_TYPE;
```

Add this handler function (before `create_router`):

```rust
async fn serve_pi_file(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path((plugin_uuid, rel_path)): Path<(String, String)>,
) -> impl IntoResponse {
    if !is_localhost_addr(&addr) {
        return StatusCode::FORBIDDEN.into_response();
    }

    // Path safety: no traversal, no absolute paths
    if rel_path.contains("..") || rel_path.starts_with('/') {
        return StatusCode::BAD_REQUEST.into_response();
    }

    let plugin_dir = {
        let host = state.plugin_host.lock().await;
        host.plugin_dirs.get(&plugin_uuid).cloned()
    };

    let plugin_dir = match plugin_dir {
        Some(d) => d,
        None => return StatusCode::NOT_FOUND.into_response(),
    };

    let file_path = plugin_dir.join(&rel_path);
    let bytes = match tokio::fs::read(&file_path).await {
        Ok(b) => b,
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    };

    let mime = mime_guess::from_path(&rel_path).first_or_octet_stream();
    let content_type = mime.as_ref().to_string();

    if content_type.contains("text/html") {
        // Generate PI token, inject bridge
        let token: String = {
            use rand::Rng;
            let bytes: [u8; 32] = rand::thread_rng().gen();
            bytes.iter().map(|b| format!("{:02x}", b)).collect()
        };
        {
            let mut host = state.plugin_host.lock().await;
            host.pi_token_map.insert(token.clone(), plugin_uuid.clone());
        }
        let html = String::from_utf8_lossy(&bytes);
        let bridge = format!(
            r#"<script>
const PI_TOKEN = '{token}';
window.connectElgatoStreamDeckSocket = function(inPort, inUUID, inRegisterEvent, inInfo, inActionInfo) {{
  const ws = new WebSocket(`ws://127.0.0.1:${{inPort}}/ws?token=${{PI_TOKEN}}`);
  ws.onopen = () => ws.send(JSON.stringify({{
    event: inRegisterEvent,
    uuid: inUUID,
    actionInfo: typeof inActionInfo === 'string' ? JSON.parse(inActionInfo) : inActionInfo
  }}));
  ws.onmessage = (e) => {{
    const msg = JSON.parse(e.data);
    window.dispatchEvent(new MessageEvent(msg.event || 'message', {{ data: e.data }}));
  }};
}};
</script>"#
        );
        let injected = html.replacen("</body>", &format!("{bridge}</body>"), 1);
        return (
            StatusCode::OK,
            [(CONTENT_TYPE, "text/html; charset=utf-8")],
            injected,
        ).into_response();
    }

    (
        StatusCode::OK,
        [(CONTENT_TYPE, content_type)],
        bytes,
    ).into_response()
}
```

### Step 4: Register PI route in `create_router`

In `create_router`, add to the public router (not admin):

```rust
.route("/pi/{uuid}/{path}", get(serve_pi_file))
```

Note: `{path}` here is a single segment. For nested paths, use `{*path}`:
```rust
.route("/pi/{uuid}/{*path}", get(serve_pi_file))
```

And update the handler signature's Path extractor accordingly:
```rust
Path((plugin_uuid, rel_path)): Path<(String, String)>,
```

### Step 5: Add `mime_guess` dependency if missing

Check if `mime_guess` is already in Cargo.toml:
```bash
grep "mime_guess" packages/desktop/src-tauri/Cargo.toml
```

If missing, add to `[dependencies]`:
```toml
mime_guess = "2"
```

### Step 6: Run tests

```bash
cd packages/desktop/src-tauri && cargo test 2>&1 | grep -E "FAILED|ok$|error\["
```

Expected: all pass including the 2 new PI route tests.

### Step 7: Commit

```bash
git add packages/desktop/src-tauri/src/server/routes.rs \
        packages/desktop/src-tauri/Cargo.toml \
        packages/desktop/src-tauri/Cargo.lock
git commit -m "feat: add /pi/{uuid}/{*path} route with PI token generation and bridge script injection"
```

---

## Task 3: PI WebSocket Registration

**Files:** `src/plugin/ws.rs`, `src/events/inbound.rs`

**Goal:** Complete the `registerPropertyInspector` stub. Implement PI sender channel, token validation, and bidirectional message routing (plugin→PI via `sendToPropertyInspector`, PI→plugin via `sendToPlugin`).

### Step 1: Write failing tests

Add to `ws.rs` test block:

```rust
#[test]
fn pi_token_map_stores_token() {
    // Unit test for token lookup pattern used in PI registration
    let mut map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    map.insert("tok123".into(), "com.test.plugin".into());
    assert_eq!(map.get("tok123").map(|s| s.as_str()), Some("com.test.plugin"));
    // Consumed on use
    map.remove("tok123");
    assert!(map.get("tok123").is_none());
}
```

Add to `inbound.rs` test block (after existing tests):

```rust
#[tokio::test]
async fn send_to_pi_logs_when_no_pi_sender() {
    // If no PI sender registered, sendToPropertyInspector silently drops
    let state = test_state(vec![]);
    dispatch(serde_json::json!({
        "event": "sendToPropertyInspector",
        "context": "ctx001",
        "payload": {"key": "value"}
    }), "com.test.plugin", &state).await;
    // No panic = pass
}
```

### Step 2: Add `pi_sender` to PluginState

In `plugin/mod.rs`, add a PI sender field to `PluginState`:

```rust
pub struct PluginState {
    pub process: Option<Child>,
    pub process_group_id: Option<u32>,
    pub sender: Option<mpsc::Sender<serde_json::Value>>,
    pub pi_sender: Option<mpsc::Sender<serde_json::Value>>,  // ← ADD THIS
    pub pre_reg_queue: VecDeque<serde_json::Value>,
    pub restart_handle: Option<JoinHandle<()>>,
    pub status: PluginStatus,
    pub unsupported_events: HashSet<String>,
    pub settings_not_persisted: bool,
    pub crash_count: u32,
    pub last_crash_window_start: Instant,
}
```

Update `PluginState::new()` to initialize `pi_sender: None`.

### Step 3: Complete PI registration in ws.rs

Replace the stub (lines 74-78):

```rust
if is_pi && event == "registerPropertyInspector" {
    // PI registration — full impl in Plan 2
    tracing::debug!("PI registration stub");
    return;
}
```

With full implementation:

```rust
if is_pi && event == "registerPropertyInspector" {
    handle_pi_registration(msg, pi_token, socket, state).await;
    return;
}
```

Add the `handle_pi_registration` function below `handle_ws`:

```rust
async fn handle_pi_registration(
    _first_msg: serde_json::Value,
    pi_token: Option<String>,
    socket: WebSocket,
    state: Arc<AppState>,
) {
    let token = match pi_token {
        Some(t) => t,
        None => {
            tracing::warn!("PI registration: no token in query string");
            return;
        }
    };

    // Look up plugin_uuid from token (consume token)
    let plugin_uuid = {
        let mut host = state.plugin_host.lock().await;
        host.pi_token_map.remove(&token)
    };

    let plugin_uuid = match plugin_uuid {
        Some(u) => u,
        None => {
            tracing::warn!("PI registration: unknown or consumed token");
            return;
        }
    };

    // Validate plugin is running
    let plugin_running = {
        let host = state.plugin_host.lock().await;
        host.plugins.get(&plugin_uuid)
            .map(|ps| ps.status == crate::plugin::PluginStatus::Running)
            .unwrap_or(false)
    };

    if !plugin_running {
        tracing::warn!(plugin=%plugin_uuid, "PI registration: plugin not running");
        return;
    }

    tracing::info!(plugin=%plugin_uuid, "PI registered via WS");

    let (pi_tx, mut pi_rx) = tokio::sync::mpsc::channel::<serde_json::Value>(CHANNEL_CAPACITY);

    // Store PI sender in PluginState
    {
        let mut host = state.plugin_host.lock().await;
        if let Some(ps) = host.plugins.get_mut(&plugin_uuid) {
            ps.pi_sender = Some(pi_tx.clone());
        }
    }

    let (mut ws_tx, mut ws_rx) = socket.split();

    // PI sender task: drain mpsc → WebSocket
    let send_uuid = plugin_uuid.clone();
    let send_state = state.clone();
    tokio::spawn(async move {
        while let Some(msg) = pi_rx.recv().await {
            let text = serde_json::to_string(&msg).unwrap_or_default();
            if ws_tx.send(Message::Text(text)).await.is_err() {
                break;
            }
        }
        // PI disconnected — clear pi_sender
        let mut host = send_state.plugin_host.lock().await;
        if let Some(ps) = host.plugins.get_mut(&send_uuid) {
            ps.pi_sender = None;
        }
    });

    // PI receive loop: forward sendToPlugin messages to plugin
    let recv_uuid = plugin_uuid.clone();
    while let Some(Ok(Message::Text(text))) = ws_rx.next().await {
        if let Ok(msg) = serde_json::from_str::<serde_json::Value>(&text) {
            let event = msg.get("event").and_then(|v| v.as_str()).unwrap_or("");
            if event == "sendToPlugin" {
                let context = msg.get("context").and_then(|v| v.as_str()).unwrap_or("");
                let payload = msg.get("payload").cloned().unwrap_or(serde_json::Value::Null);
                let fwd = crate::events::outbound::send_to_plugin(context, &payload);
                let host = state.plugin_host.lock().await;
                host.try_send(&recv_uuid, fwd);
            }
        }
    }

    // PI disconnected
    {
        let mut host = state.plugin_host.lock().await;
        if let Some(ps) = host.plugins.get_mut(&plugin_uuid) {
            ps.pi_sender = None;
        }
    }
    tracing::info!(plugin=%plugin_uuid, "PI WS disconnected");
}
```

### Step 4: Wire `sendToPropertyInspector` in inbound.rs

Replace the stub `on_send_to_pi`:

```rust
fn on_send_to_pi(msg: &serde_json::Value, plugin_uuid: &str) {
    let ctx = msg.get("context").and_then(|v| v.as_str()).unwrap_or("?");
    tracing::debug!(plugin=%plugin_uuid, ctx=%ctx, "sendToPropertyInspector (PI routing in Plan 2)");
}
```

With:

```rust
fn on_send_to_pi(msg: &serde_json::Value, plugin_uuid: &str, state: &Arc<AppState>) {
    // Called from dispatch which already has no lock — we need to try_send to PI sender
    // Use block_on is not available in async context; use try_lock instead
    let context = msg.get("context").and_then(|v| v.as_str()).unwrap_or("");
    let action_uuid = msg.get("action").and_then(|v| v.as_str()).unwrap_or("");
    let payload = msg.get("payload").cloned().unwrap_or(serde_json::Value::Null);
    let fwd = crate::events::outbound::send_to_property_inspector(action_uuid, context, &payload);
    if let Ok(host) = state.plugin_host.try_lock() {
        if let Some(ps) = host.plugins.get(plugin_uuid) {
            if let Some(pi_tx) = &ps.pi_sender {
                let _ = pi_tx.try_send(fwd);
            }
        }
    }
}
```

Update the `dispatch` function signature and `sendToPropertyInspector` arm:

```rust
pub async fn dispatch(msg: serde_json::Value, plugin_uuid: &str, state: &Arc<AppState>) {
    // ...
    "sendToPropertyInspector" => on_send_to_pi(&msg, plugin_uuid, state),
    // ...
}
```

Note: `on_send_to_pi` is now sync (uses `try_lock`). The function signature changes but it's still called from the async `dispatch`.

### Step 5: Run tests

```bash
cd packages/desktop/src-tauri && cargo test 2>&1 | grep -E "FAILED|ok$|error\["
```

Expected: all pass.

### Step 6: Commit

```bash
git add packages/desktop/src-tauri/src/plugin/mod.rs \
        packages/desktop/src-tauri/src/plugin/ws.rs \
        packages/desktop/src-tauri/src/events/inbound.rs
git commit -m "feat: complete PI WS registration with token auth, pi_sender channel, and bidirectional message routing"
```

---

## Task 4: Built-in Plugin Source

**Files:** New files in `packages/desktop/src-tauri/plugins/`

**Goal:** Create `com.pannacotta.system.sdPlugin` and `com.pannacotta.browser.sdPlugin` as standard `.sdPlugin` packages: manifest.json + bin/plugin.js. macOS-first. No npm dependencies. Pure Node.js using `child_process` and `osascript`.

### Step 1: Create directory structure

```bash
mkdir -p packages/desktop/src-tauri/plugins/com.pannacotta.system.sdPlugin/bin
mkdir -p packages/desktop/src-tauri/plugins/com.pannacotta.browser.sdPlugin/bin
```

### Step 2: Create system plugin manifest

Create `packages/desktop/src-tauri/plugins/com.pannacotta.system.sdPlugin/manifest.json`:

```json
{
  "Name": "System Actions",
  "Version": "1.0.0",
  "Author": "Panna Cotta",
  "Description": "Built-in system actions: open apps, volume, brightness, sleep, lock, run commands",
  "UUID": "com.pannacotta.system",
  "CodePath": "bin/plugin.js",
  "SDKVersion": 2,
  "OS": [
    { "Platform": "mac", "MinimumVersion": "10.15" },
    { "Platform": "windows", "MinimumVersion": "10" },
    { "Platform": "linux", "MinimumVersion": "" }
  ],
  "Actions": [
    {
      "Name": "Open App",
      "UUID": "com.pannacotta.system.open-app",
      "Icon": "assets/open-app"
    },
    {
      "Name": "Volume Up",
      "UUID": "com.pannacotta.system.volume-up",
      "Icon": "assets/volume-up"
    },
    {
      "Name": "Volume Down",
      "UUID": "com.pannacotta.system.volume-down",
      "Icon": "assets/volume-down"
    },
    {
      "Name": "Volume Mute",
      "UUID": "com.pannacotta.system.volume-mute",
      "Icon": "assets/volume-mute"
    },
    {
      "Name": "Brightness Up",
      "UUID": "com.pannacotta.system.brightness-up",
      "Icon": "assets/brightness-up"
    },
    {
      "Name": "Brightness Down",
      "UUID": "com.pannacotta.system.brightness-down",
      "Icon": "assets/brightness-down"
    },
    {
      "Name": "Sleep",
      "UUID": "com.pannacotta.system.sleep",
      "Icon": "assets/sleep"
    },
    {
      "Name": "Lock Screen",
      "UUID": "com.pannacotta.system.lock",
      "Icon": "assets/lock"
    },
    {
      "Name": "Run Command",
      "UUID": "com.pannacotta.system.run-command",
      "Icon": "assets/run-command"
    }
  ]
}
```

### Step 3: Create system plugin JS

Create `packages/desktop/src-tauri/plugins/com.pannacotta.system.sdPlugin/bin/plugin.js`:

```javascript
'use strict';
const { execSync } = require('child_process');
const WebSocket = require('ws');

const args = {};
for (let i = 2; i < process.argv.length - 1; i += 2) {
  args[process.argv[i]] = process.argv[i + 1];
}
const PORT = args['-port'];
const UUID = args['-pluginUUID'];
const REGISTER_EVENT = args['-registerEvent'];

const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);

ws.on('open', () => {
  ws.send(JSON.stringify({ event: REGISTER_EVENT, uuid: UUID }));
});

ws.on('message', (data) => {
  let msg;
  try { msg = JSON.parse(data.toString()); } catch { return; }
  if (msg.event === 'keyDown') {
    handleKeyDown(msg).catch((err) => {
      ws.send(JSON.stringify({
        event: 'logMessage',
        payload: { message: `Error: ${err.message}` }
      }));
    });
  }
});

function run(cmd) {
  try { execSync(cmd, { stdio: 'ignore' }); } catch (e) { throw new Error(`Command failed: ${cmd}`); }
}

async function handleKeyDown(msg) {
  const action = msg.action;
  const settings = (msg.payload && msg.payload.settings) || {};

  switch (action) {
    case 'com.pannacotta.system.open-app': {
      const appName = settings.appName;
      if (!appName) throw new Error('missing appName');
      if (process.platform === 'darwin') {
        run(`open -a "${appName.replace(/"/g, '\\"')}"`);
      } else if (process.platform === 'win32') {
        run(`start "" "${appName.replace(/"/g, '\\"')}"`);
      } else {
        run(`xdg-open "${appName.replace(/"/g, '\\"')}"`);
      }
      break;
    }
    case 'com.pannacotta.system.volume-up':
      if (process.platform === 'darwin') {
        run(`osascript -e 'set volume output volume (output volume of (get volume settings) + 10)'`);
      }
      break;
    case 'com.pannacotta.system.volume-down':
      if (process.platform === 'darwin') {
        run(`osascript -e 'set volume output volume (output volume of (get volume settings) - 10)'`);
      }
      break;
    case 'com.pannacotta.system.volume-mute':
      if (process.platform === 'darwin') {
        run(`osascript -e 'set volume with output muted'`);
      }
      break;
    case 'com.pannacotta.system.brightness-up':
      if (process.platform === 'darwin') {
        run(`osascript -e 'tell application "System Events" to key code 113'`);
      }
      break;
    case 'com.pannacotta.system.brightness-down':
      if (process.platform === 'darwin') {
        run(`osascript -e 'tell application "System Events" to key code 107'`);
      }
      break;
    case 'com.pannacotta.system.sleep':
      if (process.platform === 'darwin') {
        run(`osascript -e 'tell app "System Events" to sleep'`);
      } else if (process.platform === 'win32') {
        run(`rundll32.exe powrprof.dll,SetSuspendState 0,1,0`);
      } else {
        run(`systemctl suspend`);
      }
      break;
    case 'com.pannacotta.system.lock':
      if (process.platform === 'darwin') {
        run(`/System/Library/CoreServices/Menu\\ Extras/User.menu/Contents/Resources/CGSession -suspend`);
      } else if (process.platform === 'win32') {
        run(`rundll32.exe user32.dll,LockWorkStation`);
      } else {
        run(`loginctl lock-session`);
      }
      break;
    case 'com.pannacotta.system.run-command': {
      const command = settings.command;
      if (!command) throw new Error('missing command');
      run(command);
      break;
    }
    default:
      break;
  }
}

ws.on('error', (err) => {
  process.stderr.write(`WS error: ${err.message}\n`);
});

ws.on('close', () => {
  process.exit(0);
});
```

### Step 4: Create browser plugin manifest

Create `packages/desktop/src-tauri/plugins/com.pannacotta.browser.sdPlugin/manifest.json`:

```json
{
  "Name": "Browser Actions",
  "Version": "1.0.0",
  "Author": "Panna Cotta",
  "Description": "Built-in browser action: open URLs",
  "UUID": "com.pannacotta.browser",
  "CodePath": "bin/plugin.js",
  "SDKVersion": 2,
  "OS": [
    { "Platform": "mac", "MinimumVersion": "10.15" },
    { "Platform": "windows", "MinimumVersion": "10" },
    { "Platform": "linux", "MinimumVersion": "" }
  ],
  "Actions": [
    {
      "Name": "Open URL",
      "UUID": "com.pannacotta.browser.open-url",
      "Icon": "assets/open-url"
    }
  ]
}
```

### Step 5: Create browser plugin JS

Create `packages/desktop/src-tauri/plugins/com.pannacotta.browser.sdPlugin/bin/plugin.js`:

```javascript
'use strict';
const { execSync } = require('child_process');
const WebSocket = require('ws');

const args = {};
for (let i = 2; i < process.argv.length - 1; i += 2) {
  args[process.argv[i]] = process.argv[i + 1];
}
const PORT = args['-port'];
const UUID = args['-pluginUUID'];
const REGISTER_EVENT = args['-registerEvent'];

const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);

ws.on('open', () => {
  ws.send(JSON.stringify({ event: REGISTER_EVENT, uuid: UUID }));
});

ws.on('message', (data) => {
  let msg;
  try { msg = JSON.parse(data.toString()); } catch { return; }
  if (msg.event === 'keyDown') {
    handleKeyDown(msg).catch((err) => {
      ws.send(JSON.stringify({
        event: 'logMessage',
        payload: { message: `Error: ${err.message}` }
      }));
    });
  }
});

function run(cmd) {
  try { execSync(cmd, { stdio: 'ignore' }); } catch (e) { throw new Error(`Command failed: ${cmd}`); }
}

function isHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch { return false; }
}

async function handleKeyDown(msg) {
  const settings = (msg.payload && msg.payload.settings) || {};
  const url = settings.url;
  if (!url) throw new Error('missing url');
  if (!isHttpUrl(url)) throw new Error(`URL scheme not allowed: ${url}`);
  if (process.platform === 'darwin') {
    run(`open "${url.replace(/"/g, '%22')}"`);
  } else if (process.platform === 'win32') {
    run(`start "" "${url.replace(/"/g, '%22')}"`);
  } else {
    run(`xdg-open "${url.replace(/"/g, '%22')}"`);
  }
}

ws.on('error', (err) => {
  process.stderr.write(`WS error: ${err.message}\n`);
});

ws.on('close', () => {
  process.exit(0);
});
```

### Step 6: Verify manifest validation passes

Run manifest tests:

```bash
cd packages/desktop/src-tauri && cargo test manifest 2>&1 | grep -E "ok|FAILED"
```

Expected: all manifest tests pass (no new test needed — existing validation covers it).

### Step 7: Commit

```bash
git add packages/desktop/src-tauri/plugins/
git commit -m "feat: add built-in com.pannacotta.system and com.pannacotta.browser sdPlugin packages (macOS-first, no npm deps)"
```

---

## Task 5: Startup Copy + execute_command Removal

**Files:** `src/server/mod.rs`, `src/app.rs`, `src/commands/system.rs`, `src/server/routes.rs`, `Cargo.toml` (if needed), `packages/frontend/app.js`

**Goal:**
1. Copy built-in `.sdPlugin` dirs from Tauri resource dir to `~/.panna-cotta/plugins/` at startup (skip if already current version)
2. Remove `execute_command` Tauri command and `dispatch_context` Rust fallback from routes.rs
3. Clean up dead code in app.js (`executeAction` and `openUrl` methods)
4. Verify `cargo test` passes

### Step 1: Write failing tests for startup copy

Add test to `server/mod.rs` test block (or a new `#[cfg(test)]` block at bottom):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn copy_builtin_plugins_creates_dest_dir() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        // Create a fake .sdPlugin in src
        let plugin_src = src.path().join("com.test.sdPlugin");
        tokio::fs::create_dir(&plugin_src).await.unwrap();
        tokio::fs::write(plugin_src.join("manifest.json"), b"{}").await.unwrap();

        copy_builtin_plugins(src.path(), dst.path()).await.unwrap();

        assert!(dst.path().join("com.test.sdPlugin").join("manifest.json").exists());
    }
}
```

### Step 2: Add `copy_builtin_plugins` to `server/mod.rs`

Add this async function to `server/mod.rs`:

```rust
/// Copy built-in .sdPlugin dirs from Tauri resource dir to ~/.panna-cotta/plugins/.
/// Skips directories that already exist (idempotent; version gating is handled by
/// overwriting only when the resource dir version differs — for Phase 1, always copy
/// if dest doesn't exist).
pub async fn copy_builtin_plugins(
    resource_plugins_dir: &std::path::Path,
    dest_plugins_dir: &std::path::Path,
) -> Result<(), String> {
    tokio::fs::create_dir_all(dest_plugins_dir)
        .await
        .map_err(|e| format!("create plugins dir: {e}"))?;

    let mut entries = tokio::fs::read_dir(resource_plugins_dir)
        .await
        .map_err(|e| format!("read resource plugins dir: {e}"))?;

    while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if !name_str.ends_with(".sdPlugin") {
            continue;
        }
        let dest = dest_plugins_dir.join(&name);
        if dest.exists() {
            // Already copied; skip for Phase 1
            continue;
        }
        copy_dir_all(&entry.path(), &dest)
            .await
            .map_err(|e| format!("copy {name_str}: {e}"))?;
        tracing::info!("copied built-in plugin: {name_str}");
    }
    Ok(())
}

async fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    tokio::fs::create_dir_all(dst).await?;
    let mut entries = tokio::fs::read_dir(src).await?;
    while let Some(entry) = entries.next_entry().await? {
        let ty = entry.file_type().await?;
        let dst_path = dst.join(entry.file_name());
        if ty.is_dir() {
            Box::pin(copy_dir_all(&entry.path(), &dst_path)).await?;
        } else {
            tokio::fs::copy(&entry.path(), &dst_path).await?;
        }
    }
    Ok(())
}
```

### Step 3: Call `copy_builtin_plugins` from app.rs

In `app.rs`, after the server starts and before `post_start_spawn`, add the built-in copy call.

Find where `post_start_spawn` is called in `app.rs`. Before it, add:

```rust
// Copy built-in plugins from Tauri resources to ~/.panna-cotta/plugins/
let resource_dir = app.path().resource_dir()
    .map_err(|e| format!("resource dir: {e}"))?;
let resource_plugins = resource_dir.join("plugins");
let dest_plugins = state.config_dir.join("plugins");
if resource_plugins.exists() {
    if let Err(e) = crate::server::mod_::copy_builtin_plugins(&resource_plugins, &dest_plugins).await {
        tracing::warn!("copy built-in plugins: {e}");
    }
}
```

Note: `mod_` is not valid Rust syntax. The function is in `server/mod.rs` so call it as:
```rust
if let Err(e) = crate::server::copy_builtin_plugins(&resource_plugins, &dest_plugins).await {
```

Make sure `pub use` or `pub mod` makes `copy_builtin_plugins` accessible from `crate::server::`.

Check the current `app.rs` for how `post_start_spawn` is called and insert accordingly.

### Step 4: Add Tauri resource configuration for built-in plugins

In `tauri.conf.json`, in the `bundle` section, add resources:

```json
"resources": {
  "plugins/com.pannacotta.system.sdPlugin/**": "plugins/com.pannacotta.system.sdPlugin/",
  "plugins/com.pannacotta.browser.sdPlugin/**": "plugins/com.pannacotta.browser.sdPlugin/"
}
```

If `bundle.resources` already exists as a list (array), check the existing format and add accordingly:
```json
"resources": ["plugins/**"]
```

### Step 5: Remove `execute_command` Tauri command

In `app.rs`, remove `crate::commands::system::execute_command` from the `invoke_handler!` macro list.

In `commands/system.rs`:
- Remove the `execute_command` function entirely (lines implementing it).
- Keep `open_app`, `open_url`, `validate_url_scheme`, and other functions.

### Step 6: Remove `dispatch_context` Rust fallback from routes.rs

In `routes.rs`, the execute handler currently (lines 383-387):
```rust
let result = if plugin_dispatched {
    Ok(())
} else {
    dispatch_context(&button).await
};
```

Replace with plugin-only dispatch:
```rust
let result = if plugin_dispatched {
    Ok(())
} else {
    // No plugin running for this action — return 503
    Err(format!("no plugin running for actionUUID: {}", button.action_uuid))
};
```

Change the 500 response to 503:
```rust
Err(e) => {
    tracing::warn!(action = %button.action_uuid, context = %button.context, error = %e, "button dispatch failed");
    (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({"error": e}))).into_response()
}
```

Also delete the `dispatch_context` function and `run_shell_command` function entirely from routes.rs (they're no longer needed).

Also remove the legacy `{ action, target }` path from the execute handler:
```rust
} else if let (Some(action), Some(target)) = (body.action, body.target) {
    // ... remove this whole arm
}
```

Simplify `ExecuteBody`:
```rust
#[derive(serde::Deserialize)]
struct ExecuteBody {
    context: Option<String>,
}
```

And the final else:
```rust
} else {
    (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "provide {context}"}))).into_response()
}
```

### Step 7: Clean up app.js dead code

In `packages/frontend/app.js`, remove the unused `executeAction` and `openUrl` methods from `StreamDeckAPI`:

```javascript
// Remove:
async executeAction(action, target) { ... }
async openUrl(url) { ... }
```

Keep `getConfig()` and `ping()`.

### Step 8: Fix any compile errors from execute_command removal

```bash
cd packages/desktop/src-tauri && cargo check 2>&1 | grep "error\["
```

Fix any remaining references to `execute_command` in routes.rs or other files.

### Step 9: Run full test suite

```bash
cd packages/desktop/src-tauri && cargo test 2>&1
```

Some tests in routes.rs that test the old legacy execute path (e.g., `execute_legacy_from_lan_rejected`) will now fail or need updating. Update these tests:
- `execute_legacy_from_lan_rejected` → update to expect 400 ("provide {context}") since legacy path is removed
- Any test that calls `dispatch_context` directly → remove or update

Run again:
```bash
cd packages/desktop/src-tauri && cargo test 2>&1 | grep -E "FAILED|ok$"
```

Expected: all pass.

### Step 10: Run cargo clippy

```bash
cd packages/desktop/src-tauri && cargo clippy 2>&1 | grep "^error"
```

Expected: no errors.

### Step 11: Commit

```bash
git add packages/desktop/src-tauri/src/server/mod.rs \
        packages/desktop/src-tauri/src/app.rs \
        packages/desktop/src-tauri/src/commands/system.rs \
        packages/desktop/src-tauri/src/server/routes.rs \
        packages/desktop/src-tauri/tauri.conf.json \
        packages/frontend/app.js
git commit -m "feat: copy built-in plugins at startup; remove execute_command Rust fallback; clean dead code"
```

---

## Final Verification

After all tasks complete:

```bash
cd packages/desktop/src-tauri && cargo test 2>&1
cd packages/desktop/src-tauri && cargo clippy 2>&1 | grep "^error"
cd packages/desktop && npm run build 2>&1
```

Expected: all clean.
