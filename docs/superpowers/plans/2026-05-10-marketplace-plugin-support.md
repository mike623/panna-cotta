# Marketplace Plugin Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Elgato Stream Deck marketplace plugins (e.g. Spotify) to run in Panna Cotta end-to-end — one-click `streamdeck://` deep-link install, plugin process spawns, buttons show plugin-pushed images and titles.

**Architecture:** A `PluginRenderState` struct (images/titles/states maps) lives on `AppState` and is shared with `PluginHost`. Inbound plugin events (`setImage`, `setTitle`, etc.) write to it and fire a Tauri `plugin-render-updated` event. The LAN panel polls `/api/plugin-render`; the admin UI listens for the Tauri event and re-fetches. Deep-link install downloads a `.streamDeckPlugin` ZIP, extracts it, validates the manifest, and hot-loads the plugin without restart.

**Tech Stack:** Rust/Tauri 2, Axum, `tauri-plugin-deep-link = "2"`, `reqwest = "0.12"` (rustls), `zip = "2"`, Svelte, TypeScript.

---

## File Map

| File | Change |
|---|---|
| `src-tauri/src/plugin/manifest.rs` | Bump SDKVersion cap 2 → 6 |
| `src-tauri/src/server/state.rs` | Add `PluginRenderState` struct + fields on `AppState` |
| `src-tauri/src/plugin/mod.rs` | Add `plugin_render` to `PluginHost`; update `new()` sig; wipe contexts in `stop_plugin` |
| `src-tauri/src/events/outbound.rs` | Add `did_receive_global_settings` |
| `src-tauri/src/commands/plugins.rs` | Add `read_global_settings`, `write_global_settings`, `get_plugin_render` command |
| `src-tauri/src/events/inbound.rs` | Add 5 new event handlers; fire Tauri events |
| `src-tauri/src/server/routes.rs` | Add `GET /api/plugin-render` route |
| `src-tauri/src/commands/mod.rs` | Add `pub mod plugin_install` |
| `src-tauri/src/commands/plugin_install.rs` | Create — download/unzip/validate/hot-load flow |
| `src-tauri/src/app.rs` | Register deep-link plugin; set `app_handle` on `AppState`; wire deep-link handler |
| `src-tauri/Cargo.toml` | Add `tauri-plugin-deep-link`, `reqwest`, `zip` |
| `src-tauri/tauri.conf.json` | Add `deep-link` plugin config with `streamdeck` scheme |
| `packages/frontend/app.js` | Poll `/api/plugin-render`; render plugin images/titles |
| `packages/desktop/src/lib/types.ts` | Add `PluginRenderState` interface |
| `packages/desktop/src/lib/invoke.ts` | Add `getPluginRender()` |
| `packages/desktop/src/components/GridEditor.svelte` | Accept `pluginRender` prop; render plugin images/titles |
| `packages/desktop/src/App.svelte` | Fetch/listen `plugin-render-updated`; listen `plugin-installed`; pass to GridEditor |

---

## Task 1: Bump SDKVersion cap

**Files:**
- Modify: `packages/desktop/src-tauri/src/plugin/manifest.rs:73`

- [ ] **Step 1: Write the two failing tests** (add to the existing `#[cfg(test)]` block)

```rust
#[test]
fn sdk_version_6_passes() {
    let mut m = valid();
    m.sdk_version = 6;
    assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_ok());
}

#[test]
fn sdk_version_7_fails() {
    let mut m = valid();
    m.sdk_version = 7;
    assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_err());
}
```

- [ ] **Step 2: Run to verify both fail**

```bash
cd packages/desktop/src-tauri && cargo test manifest::tests::sdk_version
```

Expected: `sdk_version_6_passes` FAILS (rejects 6), `sdk_version_7_fails` FAILS (accepts 7).

- [ ] **Step 3: Change the cap**

In `manifest.rs` line 73, change:
```rust
    if manifest.sdk_version > 2 {
        return Err(format!("SDKVersion {} > 2 is not supported", manifest.sdk_version));
    }
```
to:
```rust
    if manifest.sdk_version > 6 {
        return Err(format!("SDKVersion {} > 6 is not supported", manifest.sdk_version));
    }
```

- [ ] **Step 4: Run all manifest tests**

```bash
cd packages/desktop/src-tauri && cargo test manifest::tests
```

Expected: all pass, including the existing `sdk_version_too_high_fails` test — update that test too so it uses `sdk_version = 7`:

```rust
#[test]
fn sdk_version_too_high_fails() {
    let mut m = valid();
    m.sdk_version = 7;
    assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_err());
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src-tauri/src/plugin/manifest.rs
git commit -m "feat: bump SDKVersion cap from 2 to 6"
```

---

## Task 2: PluginRenderState + AppState + PluginHost

**Files:**
- Modify: `packages/desktop/src-tauri/src/server/state.rs`
- Modify: `packages/desktop/src-tauri/src/plugin/mod.rs`

`PluginRenderState` is created on `AppState`, shared via `Arc<Mutex<...>>` into `PluginHost` — the same pattern as `profile_state`. This lets `stop_plugin` wipe contexts without needing `AppState`.

- [ ] **Step 1: Write failing tests for PluginRenderState**

Add to the `#[cfg(test)]` block in `state.rs`:

```rust
#[test]
fn plugin_render_state_remove_contexts() {
    let mut r = PluginRenderState::default();
    r.images.insert("ctx1".into(), "data:image/png;base64,abc".into());
    r.titles.insert("ctx1".into(), "Track".into());
    r.states.insert("ctx1".into(), 1);
    r.images.insert("ctx2".into(), "data:image/png;base64,def".into());
    r.remove_contexts(&["ctx1".to_string()]);
    assert!(!r.images.contains_key("ctx1"));
    assert!(!r.titles.contains_key("ctx1"));
    assert!(!r.states.contains_key("ctx1"));
    assert!(r.images.contains_key("ctx2")); // ctx2 untouched
}
```

Run to verify it fails (PluginRenderState doesn't exist yet):

```bash
cd packages/desktop/src-tauri && cargo test state::tests::plugin_render_state_remove_contexts 2>&1 | tail -5
```

- [ ] **Step 2: Add PluginRenderState to state.rs**

Add to the imports at the top of `state.rs` (after the existing `use std::path::PathBuf;`):
```rust
use std::collections::HashMap;
```

Add the struct and impl (before the `AppState` struct definition):
```rust
#[derive(Debug, Default)]
pub struct PluginRenderState {
    pub images: HashMap<String, String>,
    pub titles: HashMap<String, String>,
    pub states: HashMap<String, u32>,
}

impl PluginRenderState {
    pub fn remove_contexts(&mut self, contexts: &[String]) {
        for ctx in contexts {
            self.images.remove(ctx);
            self.titles.remove(ctx);
            self.states.remove(ctx);
        }
    }
}
```

- [ ] **Step 3: Add plugin_render + app_handle fields to AppState**

Change the `AppState` struct from:
```rust
pub struct AppState {
    pub config_dir: PathBuf,
    pub port: Mutex<Option<u16>>,
    pub csrf_token: String,
    pub plugin_host: Arc<tokio::sync::Mutex<crate::plugin::PluginHost>>,
}
```
to:
```rust
pub struct AppState {
    pub config_dir: PathBuf,
    pub port: Mutex<Option<u16>>,
    pub csrf_token: String,
    pub plugin_host: Arc<tokio::sync::Mutex<crate::plugin::PluginHost>>,
    pub plugin_render: Arc<Mutex<PluginRenderState>>,
    pub app_handle: Mutex<Option<tauri::AppHandle>>,
}
```

- [ ] **Step 4: Update AppState::new()**

Change `AppState::new()` from:
```rust
        let plugin_host = Arc::new(tokio::sync::Mutex::new(
            crate::plugin::PluginHost::new(default_config()),
        ));
        Self { config_dir, port: Mutex::new(None), csrf_token, plugin_host }
```
to:
```rust
        let plugin_render = Arc::new(Mutex::new(PluginRenderState::default()));
        let plugin_host = Arc::new(tokio::sync::Mutex::new(
            crate::plugin::PluginHost::new(default_config(), Arc::clone(&plugin_render)),
        ));
        Self {
            config_dir,
            port: Mutex::new(None),
            csrf_token,
            plugin_host,
            plugin_render,
            app_handle: Mutex::new(None),
        }
```

- [ ] **Step 5: Update the temp_state test helper in state.rs**

Find the `fn temp_state()` in the `#[cfg(test)]` block and update it:
```rust
    fn temp_state() -> (AppState, TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let plugin_render = Arc::new(std::sync::Mutex::new(PluginRenderState::default()));
        let plugin_host = Arc::new(tokio::sync::Mutex::new(
            crate::plugin::PluginHost::new(default_config(), Arc::clone(&plugin_render)),
        ));
        let state = AppState {
            config_dir: dir.path().to_path_buf(),
            port: std::sync::Mutex::new(None),
            csrf_token: "test_csrf_token_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into(),
            plugin_host,
            plugin_render,
            app_handle: std::sync::Mutex::new(None),
        };
        (state, dir)
    }
```

- [ ] **Step 6: Update PluginHost struct and new() in plugin/mod.rs**

Add `plugin_render` field to `PluginHost` struct (after the existing `plugin_dirs` field):
```rust
pub struct PluginHost {
    pub registry: HashMap<String, String>,
    pub plugins: HashMap<String, PluginState>,
    pub pending_registrations: HashMap<String, Instant>,
    pub pi_token_map: HashMap<String, String>,
    pub profile_state: Arc<tokio::sync::Mutex<StreamDeckConfig>>,
    pub manifests: HashMap<String, crate::plugin::manifest::Manifest>,
    pub plugin_dirs: HashMap<String, std::path::PathBuf>,
    pub plugin_render: Arc<std::sync::Mutex<crate::server::state::PluginRenderState>>,
}
```

Change `PluginHost::new` signature and body:
```rust
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
```

- [ ] **Step 7: Wipe render contexts in stop_plugin**

In `stop_plugin` in `plugin/mod.rs`, add context cleanup before the existing kill logic:

```rust
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
            let _ = ps;
            kill_process(child, pgid).await;
        }
        tracing::info!(uuid=%uuid, "plugin stopped");
    }
```

- [ ] **Step 8: Add a test helper fn and update all plugin/mod.rs tests**

Add this helper inside the `#[cfg(test)]` block in `plugin/mod.rs`:
```rust
    fn make_render() -> Arc<std::sync::Mutex<crate::server::state::PluginRenderState>> {
        Arc::new(std::sync::Mutex::new(crate::server::state::PluginRenderState::default()))
    }
```

Now replace every `PluginHost::new(default_config())` in the test block with `PluginHost::new(default_config(), make_render())`.
Replace every `PluginHost::new(old_cfg)` with `PluginHost::new(old_cfg, make_render())`.

There are 12 such calls — find them all with:
```bash
grep -n "PluginHost::new(" packages/desktop/src-tauri/src/plugin/mod.rs
```

- [ ] **Step 9: Update the test helpers in routes.rs**

In `routes.rs`, find `make_state` (line ~593) and `state_with_profile` (line ~683). Update both:

```rust
    fn make_state(csrf: &str) -> Arc<AppState> {
        use std::sync::Mutex;
        use std::path::PathBuf;
        let plugin_render = Arc::new(Mutex::new(
            crate::server::state::PluginRenderState::default()
        ));
        let plugin_host = Arc::new(tokio::sync::Mutex::new(
            crate::plugin::PluginHost::new(
                crate::server::state::default_config(),
                Arc::clone(&plugin_render),
            ),
        ));
        Arc::new(AppState {
            config_dir: PathBuf::from("/tmp/test-panna"),
            port: Mutex::new(None),
            csrf_token: csrf.to_string(),
            plugin_host,
            plugin_render,
            app_handle: Mutex::new(None),
        })
    }
```

```rust
    async fn state_with_profile(csrf: &str, buttons: Vec<crate::server::state::Button>) -> Arc<AppState> {
        let dir: tempfile::TempDir = tempfile::tempdir().unwrap();
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
        let plugin_render = Arc::new(std::sync::Mutex::new(
            crate::server::state::PluginRenderState::default()
        ));
        let plugin_host = Arc::new(tokio::sync::Mutex::new(
            crate::plugin::PluginHost::new(config, Arc::clone(&plugin_render)),
        ));
        Arc::new(AppState {
            config_dir: dir_path,
            port: std::sync::Mutex::new(None),
            csrf_token: csrf.to_string(),
            plugin_host,
            plugin_render,
            app_handle: std::sync::Mutex::new(None),
        })
    }
```

- [ ] **Step 10: Update test_state helper in inbound.rs**

In `events/inbound.rs` test block, find `fn test_state` and update:
```rust
    fn test_state(buttons: Vec<Button>) -> Arc<AppState> {
        let config = StreamDeckConfig { grid: Grid { rows: 2, cols: 3 }, buttons };
        let plugin_render = Arc::new(std::sync::Mutex::new(
            crate::server::state::PluginRenderState::default()
        ));
        let plugin_host = Arc::new(tokio::sync::Mutex::new(
            crate::plugin::PluginHost::new(config, Arc::clone(&plugin_render)),
        ));
        Arc::new(AppState {
            config_dir: "/tmp/test-inbound".into(),
            port: std::sync::Mutex::new(None),
            csrf_token: "test".into(),
            plugin_host,
            plugin_render,
            app_handle: std::sync::Mutex::new(None),
        })
    }
```

- [ ] **Step 11: Run all tests**

```bash
cd packages/desktop/src-tauri && cargo test
```

Expected: all tests pass. Fix any remaining compilation errors (usually a missed `PluginHost::new` call site).

- [ ] **Step 12: Commit**

```bash
git add packages/desktop/src-tauri/src/server/state.rs \
        packages/desktop/src-tauri/src/plugin/mod.rs \
        packages/desktop/src-tauri/src/server/routes.rs \
        packages/desktop/src-tauri/src/events/inbound.rs
git commit -m "feat: add PluginRenderState to AppState and PluginHost"
```

---

## Task 3: didReceiveGlobalSettings + global settings helpers

**Files:**
- Modify: `packages/desktop/src-tauri/src/events/outbound.rs`
- Modify: `packages/desktop/src-tauri/src/commands/plugins.rs`

- [ ] **Step 1: Write the failing outbound test**

Add to `outbound.rs` test block:
```rust
    #[test]
    fn did_receive_global_settings_shape() {
        let settings = serde_json::json!({"token": "abc123"});
        let msg = did_receive_global_settings("com.spotify.sdPlugin", &settings);
        assert_eq!(msg["event"], "didReceiveGlobalSettings");
        assert_eq!(msg["context"], "com.spotify.sdPlugin");
        assert_eq!(msg["payload"]["settings"]["token"], "abc123");
    }
```

Run to verify it fails:
```bash
cd packages/desktop/src-tauri && cargo test outbound::tests::did_receive_global_settings_shape
```

- [ ] **Step 2: Add didReceiveGlobalSettings to outbound.rs**

Add this function at the end of `outbound.rs` (before the `#[cfg(test)]` block):
```rust
pub fn did_receive_global_settings(plugin_uuid: &str, settings: &Value) -> Value {
    json!({
        "event": "didReceiveGlobalSettings",
        "context": plugin_uuid,
        "payload": { "settings": settings }
    })
}
```

- [ ] **Step 3: Write failing tests for global settings helpers**

Add to the test block in `commands/plugins.rs`:
```rust
    #[tokio::test]
    async fn read_global_settings_returns_empty_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        let result = read_global_settings(dir.path(), "com.spotify.sdPlugin").await;
        assert_eq!(result, serde_json::json!({}));
    }

    #[tokio::test]
    async fn write_then_read_global_settings() {
        let dir = tempfile::tempdir().unwrap();
        let value = serde_json::json!({"token": "abc"});
        write_global_settings(dir.path(), "com.spotify.sdPlugin", &value).await.unwrap();
        let read = read_global_settings(dir.path(), "com.spotify.sdPlugin").await;
        assert_eq!(read["token"], "abc");
    }

    #[tokio::test]
    async fn write_global_settings_creates_globals_dir() {
        let dir = tempfile::tempdir().unwrap();
        write_global_settings(dir.path(), "com.test.plugin", &serde_json::json!({})).await.unwrap();
        assert!(dir.path().join("globals").join("com.test.plugin.json").exists());
    }
```

Run to verify they fail:
```bash
cd packages/desktop/src-tauri && cargo test commands::plugins::tests
```

- [ ] **Step 4: Add global settings helpers to commands/plugins.rs**

Add these functions at the end of `commands/plugins.rs` (before any `#[cfg(test)]` block):

```rust
pub async fn read_global_settings(config_dir: &std::path::Path, plugin_uuid: &str) -> serde_json::Value {
    let path = config_dir.join("globals").join(format!("{}.json", plugin_uuid));
    match tokio::fs::read_to_string(&path).await {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or(serde_json::json!({})),
        Err(_) => serde_json::json!({}),
    }
}

pub async fn write_global_settings(
    config_dir: &std::path::Path,
    plugin_uuid: &str,
    value: &serde_json::Value,
) -> Result<(), String> {
    let globals_dir = config_dir.join("globals");
    tokio::fs::create_dir_all(&globals_dir).await.map_err(|e| e.to_string())?;
    let path = globals_dir.join(format!("{}.json", plugin_uuid));
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    tokio::fs::write(&tmp, json).await.map_err(|e| e.to_string())?;
    tokio::fs::rename(&tmp, &path).await.map_err(|e| e.to_string())
}
```

Also add to `plugins.rs` at the top (after the existing `use` statements), add the tempfile dev dependency import inside a `#[cfg(test)]` module if not already there.

- [ ] **Step 5: Run tests**

```bash
cd packages/desktop/src-tauri && cargo test outbound::tests && cargo test commands::plugins::tests
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src-tauri/src/events/outbound.rs \
        packages/desktop/src-tauri/src/commands/plugins.rs
git commit -m "feat: add didReceiveGlobalSettings outbound and global settings persistence"
```

---

## Task 4: New inbound events

**Files:**
- Modify: `packages/desktop/src-tauri/src/events/inbound.rs`

The five new events: `setImage`, `setTitle`, `setState`, `setGlobalSettings`, `getGlobalSettings`.

`setImage` and `setTitle` fire the Tauri event `plugin-render-updated` via a helper that reads `state.app_handle`. In tests, `app_handle` is `None` so the emit is skipped safely.

- [ ] **Step 1: Write the failing tests**

Add to `inbound.rs` test block:

```rust
    #[tokio::test]
    async fn set_image_stores_in_render_state() {
        let state = test_state(vec![]);
        dispatch(serde_json::json!({
            "event": "setImage",
            "context": "ctx001",
            "payload": { "image": "data:image/png;base64,abc=", "target": 0, "state": 0 }
        }), "com.spotify.sdPlugin", &state).await;
        let render = state.plugin_render.lock().unwrap();
        assert_eq!(render.images.get("ctx001").map(|s| s.as_str()), Some("data:image/png;base64,abc="));
    }

    #[tokio::test]
    async fn set_title_stores_in_render_state() {
        let state = test_state(vec![]);
        dispatch(serde_json::json!({
            "event": "setTitle",
            "context": "ctx001",
            "payload": { "title": "Bohemian Rhapsody", "target": 0 }
        }), "com.spotify.sdPlugin", &state).await;
        let render = state.plugin_render.lock().unwrap();
        assert_eq!(render.titles.get("ctx001").map(|s| s.as_str()), Some("Bohemian Rhapsody"));
    }

    #[tokio::test]
    async fn set_state_stores_in_render_state() {
        let state = test_state(vec![]);
        dispatch(serde_json::json!({
            "event": "setState",
            "context": "ctx001",
            "payload": { "state": 1 }
        }), "com.spotify.sdPlugin", &state).await;
        let render = state.plugin_render.lock().unwrap();
        assert_eq!(render.states.get("ctx001"), Some(&1u32));
    }

    #[tokio::test]
    async fn set_global_settings_persists_to_disk() {
        let state = test_state(vec![]);
        dispatch(serde_json::json!({
            "event": "setGlobalSettings",
            "payload": { "token": "secret123" }
        }), "com.spotify.sdPlugin", &state).await;
        let path = state.config_dir.join("globals").join("com.spotify.sdPlugin.json");
        let raw = tokio::fs::read_to_string(&path).await.unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(v["token"], "secret123");
    }

    #[tokio::test]
    async fn get_global_settings_sends_did_receive() {
        let state = test_state(vec![]);
        // Pre-write settings
        let globals_dir = state.config_dir.join("globals");
        tokio::fs::create_dir_all(&globals_dir).await.unwrap();
        tokio::fs::write(
            globals_dir.join("com.spotify.sdPlugin.json"),
            r#"{"token":"xyz"}"#,
        ).await.unwrap();
        // Manually add plugin to host so try_send can find it
        {
            let mut host = state.plugin_host.lock().await;
            let (tx, _rx) = tokio::sync::mpsc::channel(8);
            let mut ps = crate::plugin::PluginState::new();
            ps.sender = Some(tx);
            ps.status = crate::plugin::PluginStatus::Running;
            host.plugins.insert("com.spotify.sdPlugin".into(), ps);
        }
        // Should not panic
        dispatch(serde_json::json!({
            "event": "getGlobalSettings",
            "context": "com.spotify.sdPlugin"
        }), "com.spotify.sdPlugin", &state).await;
    }
```

Run to verify all fail:
```bash
cd packages/desktop/src-tauri && cargo test inbound::tests::set_image
cd packages/desktop/src-tauri && cargo test inbound::tests::set_title
cd packages/desktop/src-tauri && cargo test inbound::tests::set_state
cd packages/desktop/src-tauri && cargo test inbound::tests::set_global
cd packages/desktop/src-tauri && cargo test inbound::tests::get_global
```

- [ ] **Step 2: Add the helper and new handlers to inbound.rs**

First, add the `emit_render_updated` helper function (add before `dispatch()`):

```rust
fn emit_render_updated(state: &Arc<AppState>) {
    use tauri::Emitter;
    if let Ok(guard) = state.app_handle.lock() {
        if let Some(handle) = guard.as_ref() {
            let _ = handle.emit("plugin-render-updated", ());
        }
    }
}
```

- [ ] **Step 3: Add the five new handler functions to inbound.rs**

Add these functions (before the `#[cfg(test)]` block):

```rust
fn on_set_image(msg: &serde_json::Value, plugin_uuid: &str, state: &Arc<AppState>) {
    let context = match msg.get("context").and_then(|v| v.as_str()) {
        Some(c) => c.to_string(),
        None => return,
    };
    let image = match msg["payload"]["image"].as_str() {
        Some(i) => i.to_string(),
        None => return,
    };
    if let Ok(mut render) = state.plugin_render.lock() {
        render.images.insert(context, image);
    }
    emit_render_updated(state);
    tracing::debug!(plugin=%plugin_uuid, "setImage stored");
}

fn on_set_title(msg: &serde_json::Value, plugin_uuid: &str, state: &Arc<AppState>) {
    let context = match msg.get("context").and_then(|v| v.as_str()) {
        Some(c) => c.to_string(),
        None => return,
    };
    let title = msg["payload"]["title"].as_str().unwrap_or("").to_string();
    if let Ok(mut render) = state.plugin_render.lock() {
        render.titles.insert(context, title);
    }
    emit_render_updated(state);
    tracing::debug!(plugin=%plugin_uuid, "setTitle stored");
}

fn on_set_state(msg: &serde_json::Value, plugin_uuid: &str, state: &Arc<AppState>) {
    let context = match msg.get("context").and_then(|v| v.as_str()) {
        Some(c) => c.to_string(),
        None => return,
    };
    let state_val = msg["payload"]["state"].as_u64().unwrap_or(0) as u32;
    if let Ok(mut render) = state.plugin_render.lock() {
        render.states.insert(context, state_val);
    }
    tracing::debug!(plugin=%plugin_uuid, "setState stored");
}

async fn on_set_global_settings(msg: serde_json::Value, plugin_uuid: &str, state: &Arc<AppState>) {
    let payload = msg.get("payload").cloned().unwrap_or(serde_json::Value::Null);
    if let Err(e) = crate::commands::plugins::write_global_settings(&state.config_dir, plugin_uuid, &payload).await {
        tracing::error!(plugin=%plugin_uuid, error=%e, "setGlobalSettings: write failed");
        mark_not_persisted(plugin_uuid, state).await;
    } else {
        tracing::info!(plugin=%plugin_uuid, "setGlobalSettings persisted");
    }
}

async fn on_get_global_settings(plugin_uuid: &str, state: &Arc<AppState>) {
    let settings = crate::commands::plugins::read_global_settings(&state.config_dir, plugin_uuid).await;
    let msg = crate::events::outbound::did_receive_global_settings(plugin_uuid, &settings);
    let host = state.plugin_host.lock().await;
    host.try_send(plugin_uuid, msg);
}
```

- [ ] **Step 4: Wire new events into dispatch() and update SUPPORTED**

Change the `SUPPORTED` constant:
```rust
const SUPPORTED: &[&str] = &[
    "registerPlugin", "registerPropertyInspector",
    "setTitle", "setSettings", "getSettings",
    "showOk", "showAlert", "openUrl", "logMessage",
    "sendToPropertyInspector", "sendToPlugin",
    "setImage", "setState", "setGlobalSettings", "getGlobalSettings",
];
```

Add the new arms to the `match event` in `dispatch()`:
```rust
        "setImage"            => on_set_image(&msg, plugin_uuid, state),
        "setTitle"            => on_set_title(&msg, plugin_uuid, state),
        "setState"            => on_set_state(&msg, plugin_uuid, state),
        "setGlobalSettings"   => on_set_global_settings(msg, plugin_uuid, state).await,
        "getGlobalSettings"   => on_get_global_settings(plugin_uuid, state).await,
```

Insert these before the `_ if is_unsupported(event)` arm.

Also remove the old `on_set_title` stub (it just logged). Replace it with the new `on_set_title` above.

- [ ] **Step 5: Run all inbound tests**

```bash
cd packages/desktop/src-tauri && cargo test inbound::tests
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src-tauri/src/events/inbound.rs
git commit -m "feat: implement setImage, setTitle, setState, setGlobalSettings, getGlobalSettings"
```

---

## Task 5: /api/plugin-render route + Tauri command

**Files:**
- Modify: `packages/desktop/src-tauri/src/server/routes.rs`
- Modify: `packages/desktop/src-tauri/src/commands/plugins.rs`
- Modify: `packages/desktop/src-tauri/src/app.rs`

- [ ] **Step 1: Write the failing route test**

Add to `routes.rs` test block:
```rust
    #[tokio::test]
    async fn plugin_render_returns_empty_maps() {
        let state = make_state("tok");
        let app = create_router(state);
        let req = Request::builder()
            .uri("/api/plugin-render")
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(json["images"].is_object());
        assert!(json["titles"].is_object());
        assert!(json["states"].is_object());
    }
```

Run to verify it fails:
```bash
cd packages/desktop/src-tauri && cargo test routes::tests::plugin_render_returns_empty_maps
```

- [ ] **Step 2: Add the route handler to routes.rs**

Add the handler function (before the `#[cfg(test)]` block):
```rust
async fn get_plugin_render_handler(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let render = state.plugin_render.lock().unwrap();
    Json(serde_json::json!({
        "images": render.images,
        "titles": render.titles,
        "states": render.states,
    }))
}
```

Register it in `create_router()` in the public (unauthenticated) section — add after the existing `/api/plugins` route:
```rust
        .route("/api/plugin-render", get(get_plugin_render_handler))
```

- [ ] **Step 3: Add get_plugin_render Tauri command to commands/plugins.rs**

Add after the existing `list_plugins_cmd`:
```rust
#[derive(serde::Serialize)]
pub struct PluginRenderDto {
    pub images: std::collections::HashMap<String, String>,
    pub titles: std::collections::HashMap<String, String>,
    pub states: std::collections::HashMap<String, u32>,
}

#[tauri::command]
pub async fn get_plugin_render(state: State<'_, Arc<AppState>>) -> Result<PluginRenderDto, String> {
    let render = state.plugin_render.lock().map_err(|e| e.to_string())?;
    Ok(PluginRenderDto {
        images: render.images.clone(),
        titles: render.titles.clone(),
        states: render.states.clone(),
    })
}
```

- [ ] **Step 4: Register the command in app.rs**

In `app.rs` inside `tauri::generate_handler![...]`, add:
```rust
            crate::commands::plugins::get_plugin_render,
```

- [ ] **Step 5: Set app_handle on AppState in app.rs setup**

In the `setup` closure in `app.rs`, near the top (before the server spawn), add:
```rust
            // Store AppHandle so inbound events can fire Tauri events
            *app_state.app_handle.lock().unwrap() = Some(app.handle().clone());
```

- [ ] **Step 6: Run all tests**

```bash
cd packages/desktop/src-tauri && cargo test
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src-tauri/src/server/routes.rs \
        packages/desktop/src-tauri/src/commands/plugins.rs \
        packages/desktop/src-tauri/src/app.rs
git commit -m "feat: add /api/plugin-render endpoint and get_plugin_render Tauri command"
```

---

## Task 6: Deep link plugin install

**Files:**
- Modify: `packages/desktop/src-tauri/Cargo.toml`
- Modify: `packages/desktop/src-tauri/tauri.conf.json`
- Create: `packages/desktop/src-tauri/src/commands/plugin_install.rs`
- Modify: `packages/desktop/src-tauri/src/commands/mod.rs`
- Modify: `packages/desktop/src-tauri/src/app.rs`

- [ ] **Step 1: Add dependencies to Cargo.toml**

In `Cargo.toml` under `[dependencies]`, add:
```toml
tauri-plugin-deep-link = "2"
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls", "stream"] }
zip = "2"
```

Under `[dev-dependencies]`, add:
```toml
zip = "2"
```

- [ ] **Step 2: Add deep-link config to tauri.conf.json**

In `tauri.conf.json`, in the `"plugins"` object, add alongside the existing `"updater"` key:
```json
"deep-link": {
  "mobile": [],
  "desktop": [{ "scheme": "streamdeck" }]
}
```

- [ ] **Step 3: Create plugin_install.rs with failing tests first**

Create `packages/desktop/src-tauri/src/commands/plugin_install.rs`:

```rust
use std::path::{Path, PathBuf};

pub struct InstallResult {
    pub uuid: String,
    pub name: String,
}

/// Full install flow: download → unzip → validate → place → return uuid+name.
pub async fn install_from_url(
    url: &str,
    config_dir: &Path,
) -> Result<InstallResult, String> {
    if !url.starts_with("https://") {
        return Err(format!("URL must use https, got: {url}"));
    }

    let bytes = download_plugin(url).await?;
    let sdplugin_dir = extract_plugin(&bytes, config_dir).await?;
    let result = load_plugin_dir(&sdplugin_dir, config_dir).await?;
    Ok(result)
}

/// Download URL to bytes, aborting if > 50 MB.
async fn download_plugin(url: &str) -> Result<Vec<u8>, String> {
    const MAX_BYTES: usize = 50 * 1024 * 1024;
    let resp = reqwest::get(url).await.map_err(|e| format!("download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("download HTTP {}", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| format!("download body: {e}"))?;
    if bytes.len() > MAX_BYTES {
        return Err(format!("plugin ZIP exceeds 50 MB ({} bytes)", bytes.len()));
    }
    Ok(bytes.to_vec())
}

/// Extract the first .sdPlugin directory from a ZIP into a temp location.
/// Returns the path to the extracted .sdPlugin dir.
async fn extract_plugin(bytes: &[u8], config_dir: &Path) -> Result<PathBuf, String> {
    let bytes = bytes.to_vec();
    let config_dir = config_dir.to_path_buf();
    tokio::task::spawn_blocking(move || extract_plugin_sync(&bytes, &config_dir))
        .await
        .map_err(|e| format!("extract task: {e}"))?
}

fn extract_plugin_sync(bytes: &[u8], config_dir: &Path) -> Result<PathBuf, String> {
    use std::io::Cursor;
    let cursor = Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("invalid ZIP: {e}"))?;

    // Find the .sdPlugin root directory name
    let sdplugin_root = find_sdplugin_root(&archive)?;

    let tmp_dir = config_dir.join("plugins").join(".install-tmp");
    let dest = tmp_dir.join(&sdplugin_root);

    std::fs::create_dir_all(&tmp_dir).map_err(|e| format!("mkdir tmp: {e}"))?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| format!("ZIP entry {i}: {e}"))?;
        let raw_name = file.name().to_string();

        // Security: reject path traversal and absolute paths
        if raw_name.contains("..") || raw_name.starts_with('/') {
            // Clean up tmp dir before returning error
            let _ = std::fs::remove_dir_all(&tmp_dir);
            return Err(format!("ZIP contains unsafe path: {raw_name}"));
        }

        // Only extract entries that belong to the .sdPlugin dir
        if !raw_name.starts_with(&sdplugin_root) {
            continue;
        }

        let rel = &raw_name[sdplugin_root.len()..].trim_start_matches('/');
        if rel.is_empty() {
            continue; // the root dir entry itself
        }

        let out_path = dest.join(rel);
        if file.is_dir() {
            std::fs::create_dir_all(&out_path).map_err(|e| format!("mkdir {rel}: {e}"))?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("mkdir parent: {e}"))?;
            }
            let mut out = std::fs::File::create(&out_path)
                .map_err(|e| format!("create {rel}: {e}"))?;
            std::io::copy(&mut file, &mut out).map_err(|e| format!("write {rel}: {e}"))?;
        }
    }

    Ok(dest)
}

fn find_sdplugin_root<R: std::io::Read + std::io::Seek>(
    archive: &zip::ZipArchive<R>,
) -> Result<String, String> {
    for i in 0..archive.len() {
        // ZipArchive::name() on by_index — use file_names() iterator instead
        break; // placeholder — see implementation below
    }
    // Collect all names and find .sdPlugin root
    // (ZipArchive doesn't expose file_names without mut borrow in some versions;
    //  use by_index in a separate pass)
    Err("no .sdPlugin directory found in ZIP".into())
}

// Real implementation of find_sdplugin_root using a scan of file names
fn find_sdplugin_root_from_names(names: &[String]) -> Result<String, String> {
    for name in names {
        let parts: Vec<&str> = name.splitn(2, '/').collect();
        if parts[0].ends_with(".sdPlugin") {
            return Ok(format!("{}/", parts[0]));
        }
    }
    Err("no .sdPlugin directory found in ZIP".into())
}

/// Validate the extracted manifest and move the .sdPlugin dir to plugins/.
async fn load_plugin_dir(sdplugin_dir: &Path, config_dir: &Path) -> Result<InstallResult, String> {
    let manifest_path = sdplugin_dir.join("manifest.json");
    let raw = tokio::fs::read_to_string(&manifest_path)
        .await
        .map_err(|e| format!("read manifest: {e}"))?;
    let manifest: crate::plugin::manifest::Manifest =
        serde_json::from_str(&raw).map_err(|e| format!("parse manifest: {e}"))?;
    crate::plugin::manifest::validate(&manifest, sdplugin_dir)?;

    let dest = config_dir
        .join("plugins")
        .join(format!("{}.sdPlugin", manifest.uuid));
    if dest.exists() {
        tokio::fs::remove_dir_all(&dest)
            .await
            .map_err(|e| format!("remove old plugin: {e}"))?;
    }
    tokio::fs::rename(sdplugin_dir, &dest)
        .await
        .map_err(|e| format!("move plugin: {e}"))?;

    // Clean up the .install-tmp dir if empty
    let tmp = config_dir.join("plugins").join(".install-tmp");
    let _ = tokio::fs::remove_dir(&tmp).await;

    Ok(InstallResult {
        uuid: manifest.uuid,
        name: manifest.name,
    })
}

/// Entry point called by the deep-link handler.
/// Downloads, installs, and hot-loads the plugin. Fires Tauri events.
pub async fn handle_deep_link(
    raw_url: &str,
    state: &std::sync::Arc<crate::server::state::AppState>,
    app: &tauri::AppHandle,
) {
    use tauri::Emitter;

    // Parse: streamdeck://plugins/install?url=https://...
    let plugin_url = match extract_plugin_url(raw_url) {
        Some(u) => u,
        None => {
            tracing::warn!(url=%raw_url, "deep link: unrecognised URL format");
            return;
        }
    };

    tracing::info!(url=%plugin_url, "deep link: installing plugin");

    match install_from_url(&plugin_url, &state.config_dir).await {
        Ok(result) => {
            // Hot-reload: spawn the newly installed plugin
            hot_load_plugin(&result.uuid, state, app).await;
            let _ = app.emit("plugin-installed", serde_json::json!({
                "ok": true,
                "uuid": result.uuid,
                "name": result.name,
            }));
        }
        Err(e) => {
            tracing::error!(error=%e, "deep link: install failed");
            let _ = app.emit("plugin-installed", serde_json::json!({
                "ok": false,
                "error": e,
            }));
        }
    }
}

fn extract_plugin_url(raw_url: &str) -> Option<String> {
    // Format: streamdeck://plugins/install?url=https://...
    let parsed = url::Url::parse(raw_url).ok()?;
    if parsed.scheme() != "streamdeck" { return None; }
    parsed.query_pairs()
        .find(|(k, _)| k == "url")
        .map(|(_, v)| v.into_owned())
}

async fn hot_load_plugin(
    uuid: &str,
    state: &std::sync::Arc<crate::server::state::AppState>,
    app: &tauri::AppHandle,
) {
    // Re-scan plugins directory to pick up the new .sdPlugin
    let discovered = crate::plugin::discovery::scan_plugins(&state.config_dir).await;
    let new_plugin = match discovered.iter().find(|p| p.manifest.uuid == uuid) {
        Some(p) => p,
        None => {
            tracing::warn!(uuid=%uuid, "hot_load: plugin not found after install");
            return;
        }
    };

    {
        let mut host = state.plugin_host.lock().await;
        host.manifests.insert(new_plugin.manifest.uuid.clone(), new_plugin.manifest.clone());
        host.plugin_dirs.insert(new_plugin.manifest.uuid.clone(), new_plugin.plugin_dir.clone());
        for action in &new_plugin.manifest.actions {
            host.registry.insert(action.uuid.clone(), new_plugin.manifest.uuid.clone());
        }
    }

    let port = state.port.lock().ok().and_then(|g| *g).unwrap_or(0);
    let node_binary = match crate::plugin::runtime::resolve_node_binary(&state.config_dir).await {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(error=%e, "hot_load: no node binary");
            let _ = <tauri::AppHandle as tauri::Emitter>::emit(app, "node-runtime-needed", ());
            return;
        }
    };

    let mut host = state.plugin_host.lock().await;
    let code_path = new_plugin.plugin_dir.join(&new_plugin.manifest.code_path);
    if let Err(e) = host.spawn_plugin(uuid, &node_binary, &code_path, port).await {
        tracing::error!(uuid=%uuid, error=%e, "hot_load: spawn failed");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn make_valid_zip(uuid: &str) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let cursor = std::io::Cursor::new(&mut buf);
            let mut zip = zip::ZipWriter::new(cursor);
            let options = zip::write::SimpleFileOptions::default();
            zip.add_directory(format!("{uuid}.sdPlugin/"), options).unwrap();
            zip.start_file(format!("{uuid}.sdPlugin/manifest.json"), options).unwrap();
            let manifest = serde_json::json!({
                "UUID": uuid,
                "Name": "Test Plugin",
                "SDKVersion": 2,
                "CodePath": "bin/plugin.js",
                "Actions": [{"UUID": format!("{uuid}.action"), "Name": "Act"}]
            });
            zip.write_all(manifest.to_string().as_bytes()).unwrap();
            zip.add_directory(format!("{uuid}.sdPlugin/bin/"), options).unwrap();
            zip.start_file(format!("{uuid}.sdPlugin/bin/plugin.js"), options).unwrap();
            zip.write_all(b"// plugin").unwrap();
            zip.finish().unwrap();
        }
        buf
    }

    #[tokio::test]
    async fn rejects_non_https_url() {
        let dir = tempfile::tempdir().unwrap();
        let result = install_from_url("http://example.com/plugin.zip", dir.path()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("https"));
    }

    #[tokio::test]
    async fn rejects_path_traversal_in_zip() {
        let dir = tempfile::tempdir().unwrap();
        tokio::fs::create_dir_all(dir.path().join("plugins")).await.unwrap();
        let mut buf = Vec::new();
        {
            let cursor = std::io::Cursor::new(&mut buf);
            let mut zip = zip::ZipWriter::new(cursor);
            let options = zip::write::SimpleFileOptions::default();
            zip.start_file("com.evil.sdPlugin/../../../etc/passwd", options).unwrap();
            zip.write_all(b"evil").unwrap();
            zip.finish().unwrap();
        }
        let result = extract_plugin(&buf, dir.path()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("unsafe path"));
    }

    #[tokio::test]
    async fn happy_path_extracts_and_validates() {
        let dir = tempfile::tempdir().unwrap();
        tokio::fs::create_dir_all(dir.path().join("plugins")).await.unwrap();
        let uuid = "com.test.myplugin";
        let bytes = make_valid_zip(uuid);
        let sdplugin_path = extract_plugin(&bytes, dir.path()).await.unwrap();
        assert!(sdplugin_path.join("manifest.json").exists());
        assert!(sdplugin_path.join("bin").join("plugin.js").exists());
        let result = load_plugin_dir(&sdplugin_path, dir.path()).await.unwrap();
        assert_eq!(result.uuid, uuid);
        let installed = dir.path().join("plugins").join(format!("{uuid}.sdPlugin"));
        assert!(installed.join("manifest.json").exists());
    }

    #[test]
    fn extract_plugin_url_parses_streamdeck_scheme() {
        let url = "streamdeck://plugins/install?url=https://example.com/plugin.zip";
        assert_eq!(
            extract_plugin_url(url),
            Some("https://example.com/plugin.zip".into())
        );
    }

    #[test]
    fn extract_plugin_url_returns_none_for_unknown_scheme() {
        assert!(extract_plugin_url("https://example.com/foo").is_none());
    }
}
```

Note: The `find_sdplugin_root` function above has a placeholder. Replace with the correct implementation:

```rust
fn extract_plugin_sync(bytes: &[u8], config_dir: &Path) -> Result<PathBuf, String> {
    use std::io::Cursor;
    let cursor = Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("invalid ZIP: {e}"))?;

    // Collect all file names first
    let names: Vec<String> = (0..archive.len())
        .map(|i| archive.by_index_raw(i).map(|f| f.name().to_string()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("ZIP scan: {e}"))?;

    let sdplugin_root = find_sdplugin_root_from_names(&names)?;

    let tmp_dir = config_dir.join("plugins").join(".install-tmp");
    let dest = tmp_dir.join(sdplugin_root.trim_end_matches('/'));
    std::fs::create_dir_all(&tmp_dir).map_err(|e| format!("mkdir tmp: {e}"))?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| format!("ZIP entry {i}: {e}"))?;
        let raw_name = file.name().to_string();

        if raw_name.contains("..") || raw_name.starts_with('/') {
            let _ = std::fs::remove_dir_all(&tmp_dir);
            return Err(format!("ZIP contains unsafe path: {raw_name}"));
        }
        if !raw_name.starts_with(&sdplugin_root) { continue; }

        let rel = raw_name[sdplugin_root.len()..].trim_start_matches('/');
        if rel.is_empty() { continue; }

        let out_path = dest.join(rel);
        if file.is_dir() {
            std::fs::create_dir_all(&out_path).map_err(|e| format!("mkdir {rel}: {e}"))?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("mkdir parent: {e}"))?;
            }
            let mut out = std::fs::File::create(&out_path)
                .map_err(|e| format!("create {rel}: {e}"))?;
            std::io::copy(&mut file, &mut out).map_err(|e| format!("write {rel}: {e}"))?;
        }
    }
    Ok(dest)
}
```

Use this as the final `extract_plugin_sync` — it replaces the placeholder version above. Delete the `find_sdplugin_root` stub function and keep only `find_sdplugin_root_from_names`.

- [ ] **Step 4: Add plugin_install to commands/mod.rs**

In `commands/mod.rs`, add:
```rust
pub mod plugin_install;
```

- [ ] **Step 5: Register deep-link plugin and handler in app.rs**

In `app.rs`, add to imports:
```rust
use tauri_plugin_deep_link::DeepLinkExt;
```

In the `tauri::Builder::default()` chain, add the plugin (alongside the other `.plugin(...)` calls):
```rust
        .plugin(tauri_plugin_deep_link::init())
```

In the `setup` closure, after setting `app_handle`, add the deep-link handler:
```rust
            // Deep-link: intercept streamdeck://plugins/install?url=...
            {
                let state_dl = app_state.clone();
                let handle_dl = app.handle().clone();
                app.deep_link().on_open_urls(move |event| {
                    for url in event.urls() {
                        let url_str = url.to_string();
                        let s = state_dl.clone();
                        let h = handle_dl.clone();
                        tauri::async_runtime::spawn(async move {
                            crate::commands::plugin_install::handle_deep_link(&url_str, &s, &h).await;
                        });
                    }
                });
            }
```

- [ ] **Step 6: Run tests**

```bash
cd packages/desktop/src-tauri && cargo test commands::plugin_install::tests
cd packages/desktop/src-tauri && cargo test
```

Expected: all pass. If `cargo check` shows compile errors on the deep-link handler (e.g. API differences), consult `tauri-plugin-deep-link` v2 docs via:
```bash
npx ctx7@latest docs /tauri-apps/plugins-workspace "deep link on_open_urls handler Rust"
```

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src-tauri/Cargo.toml \
        packages/desktop/src-tauri/tauri.conf.json \
        packages/desktop/src-tauri/src/commands/plugin_install.rs \
        packages/desktop/src-tauri/src/commands/mod.rs \
        packages/desktop/src-tauri/src/app.rs
git commit -m "feat: deep link plugin install via streamdeck:// URI scheme"
```

---

## Task 7: LAN frontend plugin render polling

**Files:**
- Modify: `packages/frontend/app.js`

The LAN panel is a plain JS file. We add a module-level `pluginRender` variable, poll `/api/plugin-render` on the same 1 s interval as health ping, and update `renderGrid` / `renderList` to use plugin images and titles when available.

- [ ] **Step 1: Add pluginRender variable**

Near the top of `app.js`, alongside `let config` and `let connectionLost`, add:
```js
let pluginRender = { images: {}, titles: {}, states: {} };
```

- [ ] **Step 2: Add fetchPluginRender function**

Add this function near `startHealthPing`:
```js
async function fetchPluginRender() {
  try {
    const resp = await fetch(`${api.baseUrl}/api/plugin-render`);
    if (resp.ok) {
      pluginRender = await resp.json();
    }
  } catch {
    // Non-fatal: render state is best-effort
  }
}
```

- [ ] **Step 3: Poll in startHealthPing**

In `startHealthPing`, add a call to `fetchPluginRender()` inside the existing `setInterval`:
```js
function startHealthPing() {
  setInterval(async () => {
    try {
      const ok = await api.ping();
      setConnectionState(ok);
    } catch {
      setConnectionState(false);
    }
    await fetchPluginRender();  // add this line
  }, 5000);
}
```

Also call it once at startup — in the `DOMContentLoaded` handler, after `renderView()`:
```js
  await fetchPluginRender();
  renderView();
  startHealthPing();
```

Wait — `renderView` needs `pluginRender` to be populated first, so fetch before render:
```js
  await fetchPluginRender();  // fetch before first render
  renderView();
  startHealthPing();
```

- [ ] **Step 4: Update renderGrid to use plugin images and titles**

In `renderGrid`, change the button-content block from:
```js
    if (buttonConfig) {
      const icon = document.createElement("i");
      icon.setAttribute("data-lucide", buttonConfig.icon);
      icon.className = "button-icon";
      button.appendChild(icon);

      const label = document.createElement("span");
      label.className = "button-label";
      label.textContent = buttonConfig.name;
      button.appendChild(label);

      button.addEventListener("click", () => handleButtonPress(button, buttonConfig));
    }
```
to:
```js
    if (buttonConfig) {
      const pluginImage = pluginRender.images?.[buttonConfig.context];
      const pluginTitle = pluginRender.titles?.[buttonConfig.context];

      if (pluginImage) {
        const img = document.createElement("img");
        img.src = pluginImage;
        img.className = "button-plugin-img";
        button.appendChild(img);
      } else {
        const icon = document.createElement("i");
        icon.setAttribute("data-lucide", buttonConfig.icon);
        icon.className = "button-icon";
        button.appendChild(icon);
      }

      const label = document.createElement("span");
      label.className = "button-label";
      label.textContent = pluginTitle ?? buttonConfig.name;
      button.appendChild(label);

      button.addEventListener("click", () => handleButtonPress(button, buttonConfig));
    }
```

- [ ] **Step 5: Add CSS for plugin image**

In `packages/frontend/style.css`, add:
```css
.button-plugin-img {
  width: 48px;
  height: 48px;
  object-fit: cover;
  border-radius: 6px;
  flex-shrink: 0;
}
```

- [ ] **Step 6: Verify no JS errors**

```bash
cd packages/desktop && npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/app.js packages/frontend/style.css
git commit -m "feat: LAN panel polls plugin-render and displays plugin images/titles"
```

---

## Task 8: Admin UI plugin render integration

**Files:**
- Modify: `packages/desktop/src/lib/types.ts`
- Modify: `packages/desktop/src/lib/invoke.ts`
- Modify: `packages/desktop/src/components/GridEditor.svelte`
- Modify: `packages/desktop/src/App.svelte`

- [ ] **Step 1: Add PluginRenderState to types.ts**

At the end of `types.ts`, add:
```ts
export interface PluginRenderState {
  images: Record<string, string>
  titles: Record<string, string>
  states: Record<string, number>
}
```

- [ ] **Step 2: Add getPluginRender to invoke.ts**

Add to `invoke.ts`:
```ts
import type { StreamDeckConfig, Profile, ServerInfo, PluginInfo, PluginRenderState } from './types'

export const getPluginRender = () =>
  invoke<PluginRenderState>('get_plugin_render')
```

(Update the existing `import type` line to include `PluginRenderState`.)

- [ ] **Step 3: Update GridEditor.svelte to accept and render pluginRender**

In `GridEditor.svelte`, add the prop at the top of the `<script>` section (after the existing `export let selectedIndex`):
```ts
  import type { PluginRenderState } from '../lib/types'
  export let pluginRender: PluginRenderState = { images: {}, titles: {}, states: {} }
```

In the template, change the button cell content from:
```svelte
      {#if btn}
        <span class="cell-icon">{iconEmoji(btn.icon)}</span>
        <span class="cell-label">{btn.name}</span>
```
to:
```svelte
      {#if btn}
        {#if pluginRender.images[btn.context]}
          <img
            src={pluginRender.images[btn.context]}
            alt=""
            style="width:48px;height:48px;object-fit:cover;border-radius:4px;flex-shrink:0"
          />
        {:else}
          <span class="cell-icon">{iconEmoji(btn.icon)}</span>
        {/if}
        <span class="cell-label">{pluginRender.titles[btn.context] ?? btn.name}</span>
```

- [ ] **Step 4: Update App.svelte to fetch, listen, and pass pluginRender**

Add to the imports in `App.svelte`:
```ts
  import { getConfig, getDefaultConfig, listProfiles, openConfigFolder, getServerInfo, listPlugins, getPluginRender } from './lib/invoke'
  import type { StreamDeckConfig, Profile, ServerInfo, PluginInfo, PluginRenderState } from './lib/types'
```

Add the reactive variable (alongside `let plugins`):
```ts
  let pluginRender: PluginRenderState = { images: {}, titles: {}, states: {} }
```

Update `reload()` to also fetch plugin render:
```ts
  async function reload() {
    const [cfg, profs, info, plugs, render] = await Promise.all([
      getConfig(),
      listProfiles(),
      getServerInfo(),
      listPlugins().catch(() => [] as PluginInfo[]),
      getPluginRender().catch(() => ({ images: {}, titles: {}, states: {} } as PluginRenderState)),
    ])
    config = cfg
    profiles = profs
    serverInfo = info
    plugins = plugs
    pluginRender = render
    selectedIndex = -1
  }
```

Add Tauri event listeners in `onMount` (after `reload()`):
```ts
  import { listen } from '@tauri-apps/api/event'

  onMount(async () => {
    await reload()
    const unlistenRender = await listen('plugin-render-updated', async () => {
      pluginRender = await getPluginRender().catch(() => pluginRender)
    })
    const unlistenInstall = await listen<{ ok: boolean; name?: string; error?: string }>(
      'plugin-installed',
      (event) => {
        if (event.payload.ok) {
          showToast(`Plugin "${event.payload.name}" installed`, true)
          reload()
        } else {
          showToast(`Install failed: ${event.payload.error}`, false)
        }
      }
    )
    return () => { unlistenRender(); unlistenInstall() }
  })
```

Pass `pluginRender` to `GridEditor` in the template:
```svelte
      <GridEditor
        {config}
        {selectedIndex}
        {pluginRender}
        on:select={e => { selectedIndex = e.detail }}
      />
```

- [ ] **Step 5: Build and verify**

```bash
cd packages/desktop && npm run build
```

Expected: TypeScript compile succeeds, no errors.

- [ ] **Step 6: Run full Rust test suite one final time**

```bash
cd packages/desktop/src-tauri && cargo test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/lib/types.ts \
        packages/desktop/src/lib/invoke.ts \
        packages/desktop/src/components/GridEditor.svelte \
        packages/desktop/src/App.svelte
git commit -m "feat: admin UI displays plugin images and titles, listens for plugin-render-updated"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] SDKVersion cap 2→6 — Task 1
- [x] `setImage` inbound — Task 4
- [x] `setTitle` inbound — Task 4
- [x] `setState` inbound — Task 4
- [x] `setGlobalSettings` + file persistence — Tasks 3 + 4
- [x] `getGlobalSettings` + `didReceiveGlobalSettings` — Tasks 3 + 4
- [x] `PluginRenderState` on AppState — Task 2
- [x] Wipe contexts on plugin stop — Task 2
- [x] `GET /api/plugin-render` — Task 5
- [x] `get_plugin_render` Tauri command — Task 5
- [x] `app_handle` on AppState for event firing — Task 5
- [x] `tauri-plugin-deep-link` + `streamdeck://` scheme — Task 6
- [x] Download + unzip + validate + hot-load — Task 6
- [x] Deep-link handler in app.rs — Task 6
- [x] `plugin-installed` Tauri event — Task 6
- [x] LAN frontend polls + renders images/titles — Task 7
- [x] Admin UI `PluginRenderState` type + invoke — Task 8
- [x] GridEditor renders plugin images/titles — Task 8
- [x] App.svelte listens `plugin-render-updated` + `plugin-installed` — Task 8
