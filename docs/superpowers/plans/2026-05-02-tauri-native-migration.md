# Tauri Native Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Deno/Hono sidecar with a fully native Tauri app — Rust handles all backend logic, Axum serves the LAN HTTP API, and Svelte replaces the inline admin HTML.

**Architecture:** Embedded Axum server (spawned on Tauri's Tokio runtime) handles LAN access at `/apps/*` and `/api/*`. Tauri commands handle admin IPC via `invoke()`. Both share a single `Arc<AppState>`. The Svelte admin SPA is bundled by Vite and served at `tauri://localhost`.

**Tech Stack:** Rust/Tokio, Axum 0.7, `include_dir`, `toml`, `reqwest`, `semver`, Svelte 4, Vite 5, `@tauri-apps/api` v2.

---

## Phase 1 — Rust Backend

### Task 1: Cargo dependencies + module scaffold

**Files:**
- Modify: `packages/desktop/src-tauri/Cargo.toml`
- Create: `packages/desktop/src-tauri/src/commands/mod.rs`
- Create: `packages/desktop/src-tauri/src/commands/config.rs`
- Create: `packages/desktop/src-tauri/src/commands/system.rs`
- Create: `packages/desktop/src-tauri/src/commands/version.rs`
- Create: `packages/desktop/src-tauri/src/commands/server_info.rs`
- Create: `packages/desktop/src-tauri/src/server/mod.rs`
- Create: `packages/desktop/src-tauri/src/server/routes.rs`
- Create: `packages/desktop/src-tauri/src/server/state.rs`
- Modify: `packages/desktop/src-tauri/src/lib.rs`

- [ ] **Step 1: Add Cargo dependencies**

Replace `packages/desktop/src-tauri/Cargo.toml` with:

```toml
[package]
name = "panna-cotta"
version = "0.1.0"
edition = "2021"

[lib]
name = "panna_cotta_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = ["tray-icon", "image-png"] }
tauri-plugin-autostart = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
axum = { version = "0.7", features = ["tokio"] }
tokio = { version = "1", features = ["full"] }
toml = "0.8"
reqwest = { version = "0.12", features = ["json", "rustls-tls"], default-features = false }
semver = "1"
include_dir = "0.7"
mime_guess = "2"

[dev-dependencies]
tempfile = "3"
tokio = { version = "1", features = ["full", "test-util"] }

[profile.release]
opt-level = "s"
strip = true
```

- [ ] **Step 2: Create module directories and empty files**

```bash
mkdir -p packages/desktop/src-tauri/src/commands
mkdir -p packages/desktop/src-tauri/src/server
touch packages/desktop/src-tauri/src/commands/mod.rs
touch packages/desktop/src-tauri/src/commands/config.rs
touch packages/desktop/src-tauri/src/commands/system.rs
touch packages/desktop/src-tauri/src/commands/version.rs
touch packages/desktop/src-tauri/src/commands/server_info.rs
touch packages/desktop/src-tauri/src/server/mod.rs
touch packages/desktop/src-tauri/src/server/routes.rs
touch packages/desktop/src-tauri/src/server/state.rs
```

- [ ] **Step 3: Wire modules into lib.rs**

```rust
// packages/desktop/src-tauri/src/lib.rs
pub mod app;
pub mod commands;
pub mod server;
```

- [ ] **Step 4: Add stub module declarations**

`packages/desktop/src-tauri/src/commands/mod.rs`:
```rust
pub mod config;
pub mod server_info;
pub mod system;
pub mod version;
```

`packages/desktop/src-tauri/src/server/mod.rs`:
```rust
pub mod routes;
pub mod state;
```

- [ ] **Step 5: Verify it compiles**

```bash
cd packages/desktop/src-tauri && cargo check 2>&1
```
Expected: warnings about unused imports are fine; no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src-tauri/
git commit -m "chore: add Rust deps and scaffold server/commands modules"
```

---

### Task 2: AppState and config data types

**Files:**
- Modify: `packages/desktop/src-tauri/src/server/state.rs`

- [ ] **Step 1: Write the test**

```rust
// packages/desktop/src-tauri/src/server/state.rs
// (add at bottom of file after all code)

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_name_strips_special_chars() {
        assert_eq!(safe_profile_name("My Profile"), "My Profile");
        assert_eq!(safe_profile_name("Bad/Name!"), "BadName");
        assert_eq!(safe_profile_name("  "), "Default");
        assert_eq!(safe_profile_name(""), "Default");
    }

    #[test]
    fn safe_name_truncates_at_64() {
        let long = "a".repeat(100);
        assert_eq!(safe_profile_name(&long).len(), 64);
    }

    #[test]
    fn default_config_has_two_buttons() {
        let cfg = default_config();
        assert_eq!(cfg.buttons.len(), 2);
        assert_eq!(cfg.grid.rows, 2);
        assert_eq!(cfg.grid.cols, 3);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/desktop/src-tauri && cargo test state::tests 2>&1
```
Expected: FAIL — `safe_profile_name` not defined.

- [ ] **Step 3: Write AppState and all types**

```rust
// packages/desktop/src-tauri/src/server/state.rs
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Button {
    pub name: String,
    #[serde(rename = "type")]
    pub button_type: String,
    pub icon: String,
    pub action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Grid {
    pub rows: u32,
    pub cols: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamDeckConfig {
    pub grid: Grid,
    #[serde(default)]
    pub buttons: Vec<Button>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub name: String,
    #[serde(rename = "isActive")]
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionInfo {
    pub current: String,
    pub latest: Option<String>,
    #[serde(rename = "updateAvailable")]
    pub update_available: bool,
    #[serde(rename = "releaseUrl")]
    pub release_url: Option<String>,
}

#[derive(Debug, Clone)]
pub struct VersionCache {
    pub latest: String,
    pub release_url: String,
    pub fetched_at: std::time::Instant,
}

pub struct AppState {
    pub config_dir: PathBuf,
    pub version_cache: Mutex<Option<VersionCache>>,
    pub port: Mutex<Option<u16>>,
}

impl AppState {
    pub fn new() -> Self {
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_else(|_| ".".to_string());
        Self {
            config_dir: PathBuf::from(home).join(".panna-cotta"),
            version_cache: Mutex::new(None),
            port: Mutex::new(None),
        }
    }

    pub fn profiles_dir(&self) -> PathBuf {
        self.config_dir.join("profiles")
    }

    pub fn active_profile_file(&self) -> PathBuf {
        self.config_dir.join("active-profile")
    }

    pub fn legacy_config_file(&self) -> PathBuf {
        self.config_dir.join("stream-deck.config.toml")
    }
}

pub fn safe_profile_name(name: &str) -> String {
    let s: String = name
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '_' || *c == '-')
        .collect::<String>()
        .trim()
        .chars()
        .take(64)
        .collect();
    if s.is_empty() { "Default".to_string() } else { s }
}

pub fn profile_path(state: &AppState, name: &str) -> PathBuf {
    state.profiles_dir().join(format!("{}.toml", safe_profile_name(name)))
}

pub fn default_config() -> StreamDeckConfig {
    StreamDeckConfig {
        grid: Grid { rows: 2, cols: 3 },
        buttons: vec![
            Button {
                name: "Calculator".into(),
                button_type: "system".into(),
                icon: "calculator".into(),
                action: "Calculator".into(),
            },
            Button {
                name: "Google".into(),
                button_type: "browser".into(),
                icon: "chrome".into(),
                action: "https://google.com".into(),
            },
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_name_strips_special_chars() {
        assert_eq!(safe_profile_name("My Profile"), "My Profile");
        assert_eq!(safe_profile_name("Bad/Name!"), "BadName");
        assert_eq!(safe_profile_name("  "), "Default");
        assert_eq!(safe_profile_name(""), "Default");
    }

    #[test]
    fn safe_name_truncates_at_64() {
        let long = "a".repeat(100);
        assert_eq!(safe_profile_name(&long).len(), 64);
    }

    #[test]
    fn default_config_has_two_buttons() {
        let cfg = default_config();
        assert_eq!(cfg.buttons.len(), 2);
        assert_eq!(cfg.grid.rows, 2);
        assert_eq!(cfg.grid.cols, 3);
    }
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/desktop/src-tauri && cargo test state::tests 2>&1
```
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src-tauri/src/server/state.rs
git commit -m "feat: add AppState, config types, and safe_profile_name"
```

---

### Task 3: Config service — file operations

**Files:**
- Modify: `packages/desktop/src-tauri/src/server/state.rs`

- [ ] **Step 1: Write tests**

Add to the `tests` module in `state.rs`:

```rust
    use tempfile::TempDir;

    fn temp_state() -> (AppState, TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState {
            config_dir: dir.path().to_path_buf(),
            version_cache: Mutex::new(None),
            port: Mutex::new(None),
        };
        (state, dir)
    }

    #[tokio::test]
    async fn read_profile_returns_default_when_missing() {
        let (state, _dir) = temp_state();
        let cfg = read_profile(&state, "Nonexistent").await;
        assert_eq!(cfg.grid.rows, 2);
    }

    #[tokio::test]
    async fn migrate_creates_default_profile() {
        let (state, _dir) = temp_state();
        migrate_old_config(&state).await.unwrap();
        assert!(state.profiles_dir().join("Default.toml").exists());
        let name = get_active_profile_name(&state).await;
        assert_eq!(name, "Default");
    }

    #[tokio::test]
    async fn migrate_is_idempotent() {
        let (state, _dir) = temp_state();
        migrate_old_config(&state).await.unwrap();
        migrate_old_config(&state).await.unwrap(); // second call should not error
        assert!(state.profiles_dir().join("Default.toml").exists());
    }
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/desktop/src-tauri && cargo test state::tests 2>&1
```
Expected: FAIL — `read_profile`, `migrate_old_config`, `get_active_profile_name` not defined.

- [ ] **Step 3: Implement file operations**

Add these async functions to `state.rs` (before the `#[cfg(test)]` block):

```rust
pub async fn get_active_profile_name(state: &AppState) -> String {
    tokio::fs::read_to_string(state.active_profile_file())
        .await
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Default".to_string())
}

pub async fn set_active_profile_name(state: &AppState, name: &str) -> std::io::Result<()> {
    tokio::fs::write(state.active_profile_file(), safe_profile_name(name)).await
}

pub async fn read_profile(state: &AppState, name: &str) -> StreamDeckConfig {
    match tokio::fs::read_to_string(profile_path(state, name)).await {
        Ok(raw) => toml::from_str(&raw).unwrap_or_else(|_| default_config()),
        Err(_) => default_config(),
    }
}

pub async fn migrate_old_config(state: &AppState) -> std::io::Result<()> {
    let default_profile = state.profiles_dir().join("Default.toml");
    if default_profile.exists() {
        return Ok(());
    }
    tokio::fs::create_dir_all(state.profiles_dir()).await?;
    let content = tokio::fs::read_to_string(state.legacy_config_file())
        .await
        .unwrap_or_else(|_| toml::to_string(&default_config()).unwrap());
    tokio::fs::write(default_profile, content).await?;
    set_active_profile_name(state, "Default").await
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/desktop/src-tauri && cargo test state::tests 2>&1
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src-tauri/src/server/state.rs
git commit -m "feat: add config file operations (read_profile, migrate_old_config)"
```

---

### Task 4: Config service — profile CRUD

**Files:**
- Modify: `packages/desktop/src-tauri/src/server/state.rs`

- [ ] **Step 1: Write tests**

Add to `tests` module in `state.rs`:

```rust
    #[tokio::test]
    async fn list_profiles_returns_default_when_empty() {
        let (state, _dir) = temp_state();
        let profiles = list_profiles(&state).await.unwrap();
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].name, "Default");
        assert!(profiles[0].is_active);
    }

    #[tokio::test]
    async fn create_and_list_profile() {
        let (state, _dir) = temp_state();
        create_profile(&state, "Work", None).await.unwrap();
        let profiles = list_profiles(&state).await.unwrap();
        assert!(profiles.iter().any(|p| p.name == "Work"));
    }

    #[tokio::test]
    async fn activate_profile_switches_active() {
        let (state, _dir) = temp_state();
        create_profile(&state, "Work", None).await.unwrap();
        activate_profile(&state, "Work").await.unwrap();
        let active = get_active_profile_name(&state).await;
        assert_eq!(active, "Work");
    }

    #[tokio::test]
    async fn delete_profile_removes_file() {
        let (state, _dir) = temp_state();
        create_profile(&state, "Work", None).await.unwrap();
        delete_profile(&state, "Work").await.unwrap();
        assert!(!profile_path(&state, "Work").exists());
    }

    #[tokio::test]
    async fn delete_last_profile_errors() {
        let (state, _dir) = temp_state();
        migrate_old_config(&state).await.unwrap();
        let result = delete_profile(&state, "Default").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn rename_profile_renames_file() {
        let (state, _dir) = temp_state();
        create_profile(&state, "Work", None).await.unwrap();
        rename_profile(&state, "Work", "Personal").await.unwrap();
        assert!(profile_path(&state, "Personal").exists());
        assert!(!profile_path(&state, "Work").exists());
    }

    #[tokio::test]
    async fn save_and_read_config_roundtrip() {
        let (state, _dir) = temp_state();
        migrate_old_config(&state).await.unwrap();
        let mut cfg = default_config();
        cfg.grid.rows = 4;
        save_stream_deck_config(&state, &cfg).await.unwrap();
        let loaded = use_stream_deck_config(&state).await.unwrap();
        assert_eq!(loaded.grid.rows, 4);
    }
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/desktop/src-tauri && cargo test state::tests 2>&1
```
Expected: FAIL — `list_profiles`, `create_profile`, etc. not defined.

- [ ] **Step 3: Implement profile CRUD**

Add to `state.rs` (before `#[cfg(test)]`):

```rust
pub async fn list_profiles(state: &AppState) -> std::io::Result<Vec<Profile>> {
    migrate_old_config(state).await?;
    let active = get_active_profile_name(state).await;
    let mut profiles = Vec::new();

    match tokio::fs::read_dir(state.profiles_dir()).await {
        Ok(mut entries) => {
            while let Some(entry) = entries.next_entry().await? {
                let fname = entry.file_name().to_string_lossy().to_string();
                if fname.ends_with(".toml") {
                    let name = fname[..fname.len() - 5].to_string();
                    profiles.push(Profile { is_active: name == active, name });
                }
            }
        }
        Err(_) => {}
    }

    if profiles.is_empty() {
        profiles.push(Profile { name: "Default".to_string(), is_active: true });
    }
    profiles.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(profiles)
}

pub async fn create_profile(
    state: &AppState,
    name: &str,
    config: Option<&StreamDeckConfig>,
) -> Result<(), String> {
    migrate_old_config(state).await.map_err(|e| e.to_string())?;
    let path = profile_path(state, name);
    if path.exists() {
        return Err(format!("Profile \"{}\" already exists", safe_profile_name(name)));
    }
    tokio::fs::create_dir_all(state.profiles_dir())
        .await
        .map_err(|e| e.to_string())?;
    let content = toml::to_string(config.unwrap_or(&default_config()))
        .map_err(|e| e.to_string())?;
    tokio::fs::write(path, content).await.map_err(|e| e.to_string())
}

pub async fn activate_profile(state: &AppState, name: &str) -> Result<(), String> {
    let path = profile_path(state, name);
    if !path.exists() {
        return Err(format!("Profile \"{}\" not found", safe_profile_name(name)));
    }
    set_active_profile_name(state, name).await.map_err(|e| e.to_string())
}

pub async fn delete_profile(state: &AppState, name: &str) -> Result<(), String> {
    let profiles = list_profiles(state).await.map_err(|e| e.to_string())?;
    if profiles.len() <= 1 {
        return Err("Cannot delete the last profile".to_string());
    }
    let safe = safe_profile_name(name);
    tokio::fs::remove_file(profile_path(state, &safe))
        .await
        .map_err(|e| e.to_string())?;
    let active = get_active_profile_name(state).await;
    if active == safe {
        if let Some(p) = profiles.iter().find(|p| p.name != safe) {
            let _ = set_active_profile_name(state, &p.name).await;
        }
    }
    Ok(())
}

pub async fn rename_profile(state: &AppState, old: &str, new: &str) -> Result<(), String> {
    let old_safe = safe_profile_name(old);
    let new_safe = safe_profile_name(new);
    if old_safe == new_safe {
        return Ok(());
    }
    let content = tokio::fs::read_to_string(profile_path(state, &old_safe))
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::create_dir_all(state.profiles_dir())
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::write(profile_path(state, &new_safe), content)
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::remove_file(profile_path(state, &old_safe))
        .await
        .map_err(|e| e.to_string())?;
    let active = get_active_profile_name(state).await;
    if active == old_safe {
        let _ = set_active_profile_name(state, &new_safe).await;
    }
    Ok(())
}

pub async fn use_stream_deck_config(state: &AppState) -> Result<StreamDeckConfig, String> {
    migrate_old_config(state).await.map_err(|e| e.to_string())?;
    let active = get_active_profile_name(state).await;
    Ok(read_profile(state, &active).await)
}

pub async fn save_stream_deck_config(
    state: &AppState,
    config: &StreamDeckConfig,
) -> Result<(), String> {
    migrate_old_config(state).await.map_err(|e| e.to_string())?;
    let active = get_active_profile_name(state).await;
    tokio::fs::create_dir_all(state.profiles_dir())
        .await
        .map_err(|e| e.to_string())?;
    let content = toml::to_string(config).map_err(|e| e.to_string())?;
    tokio::fs::write(profile_path(state, &active), content)
        .await
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 4: Run all state tests**

```bash
cd packages/desktop/src-tauri && cargo test state::tests 2>&1
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src-tauri/src/server/state.rs
git commit -m "feat: implement profile CRUD and config read/write in Rust"
```

---

### Task 5: Tauri config commands

**Files:**
- Modify: `packages/desktop/src-tauri/src/commands/config.rs`

- [ ] **Step 1: Implement all config Tauri commands**

```rust
// packages/desktop/src-tauri/src/commands/config.rs
use std::sync::Arc;
use tauri::State;
use crate::server::state::{
    activate_profile, create_profile, default_config, delete_profile,
    list_profiles, rename_profile, save_stream_deck_config,
    use_stream_deck_config, AppState, Profile, StreamDeckConfig,
};

#[tauri::command]
pub async fn get_config(state: State<'_, Arc<AppState>>) -> Result<StreamDeckConfig, String> {
    use_stream_deck_config(&state).await
}

#[tauri::command]
pub async fn save_config(
    state: State<'_, Arc<AppState>>,
    config: StreamDeckConfig,
) -> Result<(), String> {
    save_stream_deck_config(&state, &config).await
}

#[tauri::command]
pub fn get_default_config() -> StreamDeckConfig {
    default_config()
}

#[tauri::command]
pub async fn list_profiles_cmd(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<Profile>, String> {
    list_profiles(&state).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_profile_cmd(
    state: State<'_, Arc<AppState>>,
    name: String,
) -> Result<(), String> {
    create_profile(&state, &name, None).await?;
    activate_profile(&state, &name).await
}

#[tauri::command]
pub async fn activate_profile_cmd(
    state: State<'_, Arc<AppState>>,
    name: String,
) -> Result<(), String> {
    activate_profile(&state, &name).await
}

#[tauri::command]
pub async fn rename_profile_cmd(
    state: State<'_, Arc<AppState>>,
    old_name: String,
    new_name: String,
) -> Result<(), String> {
    rename_profile(&state, &old_name, &new_name).await
}

#[tauri::command]
pub async fn delete_profile_cmd(
    state: State<'_, Arc<AppState>>,
    name: String,
) -> Result<(), String> {
    delete_profile(&state, &name).await
}

#[tauri::command]
pub async fn open_config_folder(
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let dir = state.config_dir.to_string_lossy().to_string();
    #[cfg(target_os = "macos")]
    std::process::Command::new("open").arg(&dir).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer").arg(&dir).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open").arg(&dir).spawn().map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd packages/desktop/src-tauri && cargo check 2>&1
```
Expected: no errors (warnings about unused functions are fine until app.rs is wired).

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src-tauri/src/commands/config.rs
git commit -m "feat: add Tauri config commands (get/save config, profile CRUD)"
```

---

### Task 6: System and server_info commands

**Files:**
- Modify: `packages/desktop/src-tauri/src/commands/system.rs`
- Modify: `packages/desktop/src-tauri/src/commands/server_info.rs`

- [ ] **Step 1: Implement system commands**

```rust
// packages/desktop/src-tauri/src/commands/system.rs
use std::process::Command;

#[tauri::command]
pub async fn execute_command(action: String, target: String) -> Result<(), String> {
    let output = match action.as_str() {
        "open-app" => Command::new("open").args(["-a", &target]).output(),
        "system-volume" => Command::new("osascript")
            .args(["-e", &format!("set volume output volume {target}")])
            .output(),
        "brightness" => Command::new("brightness").arg(&target).output(),
        "volume-up" => Command::new("osascript")
            .args(["-e", "set volume output volume ((output volume of (get volume settings)) + 10)"])
            .output(),
        "volume-down" => Command::new("osascript")
            .args(["-e", "set volume output volume ((output volume of (get volume settings)) - 10)"])
            .output(),
        "volume-mute" => Command::new("osascript")
            .args(["-e", "set volume output muted (not (output muted of (get volume settings)))"])
            .output(),
        "brightness-up" => Command::new("brightness").arg("0.1").output(),
        "brightness-down" => Command::new("brightness").arg("-0.1").output(),
        "sleep" => Command::new("pmset").args(["sleepnow"]).output(),
        "lock" => Command::new("osascript")
            .args(["-e", "tell application \"System Events\" to keystroke \"q\" using {command down, control down}"])
            .output(),
        _ => return Err(format!("Unknown action: {action}")),
    };
    output.map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_app(app_name: String) -> Result<(), String> {
    Command::new("open")
        .args(["-a", &app_name])
        .output()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_url(url: String) -> Result<(), String> {
    Command::new("open")
        .arg(&url)
        .output()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Implement server_info command**

```rust
// packages/desktop/src-tauri/src/commands/server_info.rs
use std::sync::Arc;
use serde::Serialize;
use tauri::State;
use crate::server::state::AppState;

#[derive(Serialize)]
pub struct ServerInfo {
    pub ip: String,
    pub port: u16,
}

fn local_ip() -> String {
    // Walk network interfaces for first non-loopback IPv4
    use std::net::UdpSocket;
    UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| { s.connect("8.8.8.8:80")?; s.local_addr() })
        .map(|a| a.ip().to_string())
        .unwrap_or_else(|_| "localhost".to_string())
}

#[tauri::command]
pub fn get_server_info(state: State<'_, Arc<AppState>>) -> Result<ServerInfo, String> {
    let port = state
        .port
        .lock()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Server not started".to_string())?;
    Ok(ServerInfo { ip: local_ip(), port })
}
```

- [ ] **Step 3: Verify compilation**

```bash
cd packages/desktop/src-tauri && cargo check 2>&1
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src-tauri/src/commands/
git commit -m "feat: add system, open_app, open_url, and get_server_info commands"
```

---

### Task 7: Version check command

**Files:**
- Modify: `packages/desktop/src-tauri/src/commands/version.rs`

- [ ] **Step 1: Implement version command**

```rust
// packages/desktop/src-tauri/src/commands/version.rs
use std::sync::Arc;
use std::time::Duration;
use tauri::State;
use crate::server::state::{AppState, VersionCache, VersionInfo};

const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");
const CACHE_TTL: Duration = Duration::from_secs(3600);
const RELEASES_URL: &str =
    "https://api.github.com/repos/mike623/panna-cotta/releases/latest";

async fn fetch_latest() -> Option<VersionCache> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .ok()?;
    let resp = client
        .get(RELEASES_URL)
        .header("User-Agent", "panna-cotta")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let data: serde_json::Value = resp.json().await.ok()?;
    let tag = data["tag_name"].as_str()?.trim_start_matches('v').to_string();
    let url = data["html_url"].as_str().unwrap_or(RELEASES_URL).to_string();
    Some(VersionCache {
        latest: tag,
        release_url: url,
        fetched_at: std::time::Instant::now(),
    })
}

fn is_newer(latest: &str, current: &str) -> bool {
    match (semver::Version::parse(latest), semver::Version::parse(current)) {
        (Ok(l), Ok(c)) => l > c,
        _ => latest != current,
    }
}

#[tauri::command]
pub async fn get_version_info(state: State<'_, Arc<AppState>>) -> Result<VersionInfo, String> {
    let needs_refresh = {
        let cache = state.version_cache.lock().map_err(|e| e.to_string())?;
        cache.as_ref().map_or(true, |c| c.fetched_at.elapsed() > CACHE_TTL)
    };

    if needs_refresh {
        if let Some(fresh) = fetch_latest().await {
            let mut cache = state.version_cache.lock().map_err(|e| e.to_string())?;
            *cache = Some(fresh);
        }
    }

    let cache = state.version_cache.lock().map_err(|e| e.to_string())?;
    let latest = cache.as_ref().map(|c| c.latest.clone());
    let release_url = cache.as_ref().map(|c| c.release_url.clone());
    let update_available = latest
        .as_deref()
        .map_or(false, |l| is_newer(l, CURRENT_VERSION));

    Ok(VersionInfo {
        current: CURRENT_VERSION.to_string(),
        latest,
        update_available,
        release_url,
    })
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd packages/desktop/src-tauri && cargo check 2>&1
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src-tauri/src/commands/version.rs
git commit -m "feat: add version check command with 1-hour cache"
```

---

### Task 8: Axum server — port resolution + startup

**Files:**
- Modify: `packages/desktop/src-tauri/src/server/mod.rs`

- [ ] **Step 1: Write port resolution test**

```rust
// packages/desktop/src-tauri/src/server/mod.rs

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn resolve_port_finds_free_port() {
        let port = resolve_port().await.unwrap();
        assert!(port >= 30000 && port < 40000);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/desktop/src-tauri && cargo test server::tests 2>&1
```
Expected: FAIL — `resolve_port` not defined.

- [ ] **Step 3: Implement server startup**

```rust
// packages/desktop/src-tauri/src/server/mod.rs
pub mod routes;
pub mod state;

use std::sync::Arc;
use tokio::net::TcpListener;
use state::AppState;

const PORT_FILE_NAME: &str = ".panna-cotta.port";

fn port_file() -> std::path::PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    std::path::PathBuf::from(home).join(PORT_FILE_NAME)
}

async fn is_port_free(port: u16) -> bool {
    TcpListener::bind(format!("0.0.0.0:{port}")).await.is_ok()
}

pub async fn resolve_port() -> Result<u16, String> {
    if let Ok(content) = tokio::fs::read_to_string(port_file()).await {
        if let Ok(p) = content.trim().parse::<u16>() {
            if (30000..40000).contains(&p) && is_port_free(p).await {
                return Ok(p);
            }
        }
    }
    for p in 30000u16..40000 {
        if is_port_free(p).await {
            tokio::fs::write(port_file(), p.to_string())
                .await
                .map_err(|e| e.to_string())?;
            return Ok(p);
        }
    }
    Err("No free port found in range 30000–39999".to_string())
}

pub async fn start(state: Arc<AppState>) -> Result<u16, String> {
    let port = resolve_port().await?;
    let router = routes::create_router(state.clone());
    let listener = TcpListener::bind(format!("0.0.0.0:{port}"))
        .await
        .map_err(|e| e.to_string())?;

    *state.port.lock().map_err(|e| e.to_string())? = Some(port);

    tauri::async_runtime::spawn(async move {
        axum::serve(listener, router).await.expect("axum server failed");
    });

    Ok(port)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn resolve_port_finds_free_port() {
        let port = resolve_port().await.unwrap();
        assert!((30000..40000).contains(&port));
    }
}
```

- [ ] **Step 4: Run test**

```bash
cd packages/desktop/src-tauri && cargo test server::tests 2>&1
```
Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src-tauri/src/server/mod.rs
git commit -m "feat: add Axum server startup with port resolution"
```

---

### Task 9: Axum routes

**Files:**
- Modify: `packages/desktop/src-tauri/src/server/routes.rs`

- [ ] **Step 1: Implement all route handlers**

```rust
// packages/desktop/src-tauri/src/server/routes.rs
use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Json, Redirect, Response},
    routing::{delete, get, patch, post, put},
    Router,
};
use include_dir::{include_dir, Dir};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

use crate::server::state::{
    activate_profile, create_profile, default_config, delete_profile,
    list_profiles, rename_profile, save_stream_deck_config,
    use_stream_deck_config, AppState, StreamDeckConfig,
};
use crate::commands::version::get_version_info_inner;

static APPS_DIR: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../../frontend");

pub fn create_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/", get(qr_page))
        .route("/apps", get(|| async { Redirect::permanent("/apps/") }))
        .route("/apps/", get(serve_apps_index))
        .route("/apps/*path", get(serve_apps_file))
        .route("/api/health", get(|| async { "OK" }))
        .route("/api/config", get(get_config).put(put_config))
        .route("/api/config/default", get(get_default_config_handler))
        .route("/api/profiles", get(list_profiles_handler).post(create_profile_handler))
        .route("/api/profiles/:name/activate", post(activate_profile_handler))
        .route("/api/profiles/:name", patch(rename_profile_handler).delete(delete_profile_handler))
        .route("/api/execute", post(execute_handler))
        .route("/api/open-app", post(open_app_handler))
        .route("/api/open-url", post(open_url_handler))
        .route("/api/open-config-folder", post(open_config_folder_handler))
        .route("/api/version", get(version_handler))
        .route("/api/check-update", get(check_update_handler))
        .with_state(state)
}

// ── Static file serving ──────────────────────────────────────────────

async fn serve_apps_index(State(_): State<Arc<AppState>>) -> impl IntoResponse {
    serve_file("index.html")
}

async fn serve_apps_file(Path(path): Path<String>) -> impl IntoResponse {
    serve_file(path.trim_start_matches('/'))
}

fn serve_file(path: &str) -> Response {
    match APPS_DIR.get_file(path) {
        Some(f) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            Response::builder()
                .header(header::CONTENT_TYPE, mime.as_ref())
                .body(Body::from(f.contents()))
                .unwrap()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

// ── QR setup page ─────────────────────────────────────────────────────

async fn qr_page(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let port = state.port.lock().unwrap().unwrap_or(30000);
    let ip = local_ip();
    let app_url = format!("http://{ip}:{port}/apps/");
    let qr_url = format!(
        "https://api.qrserver.com/v1/create-qr-code/?size=200x200&data={}",
        urlencoding::encode(&app_url)
    );
    let html = format!(r#"<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><title>Panna Cotta — Setup</title>
<style>body{{font-family:system-ui;display:flex;flex-direction:column;align-items:center;
justify-content:center;min-height:100vh;margin:0;background:#111;color:#eee}}
.card{{background:#1a1a2e;padding:2rem;border-radius:1rem;text-align:center;max-width:400px}}
h1{{margin:0 0 .5rem}}p{{color:#aaa}}img{{margin:1.5rem 0;border-radius:.5rem}}
code{{background:#2a2a3e;padding:.25rem .5rem;border-radius:.25rem}}
a{{color:#818cf8}}</style></head><body>
<div class="card"><h1>Panna Cotta</h1>
<p>Scan to open on your phone:</p>
<img src="{qr_url}" width="200" height="200" alt="QR">
<p>Or open: <a href="{app_url}"><code>{app_url}</code></a></p>
<p style="margin-top:1.5rem;border-top:1px solid #2a2a3e;padding-top:1rem">
<a href="/admin">⚙ Admin</a></p></div></body></html>"#);
    axum::response::Html(html)
}

fn local_ip() -> String {
    use std::net::UdpSocket;
    UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| { s.connect("8.8.8.8:80")?; s.local_addr() })
        .map(|a| a.ip().to_string())
        .unwrap_or_else(|_| "localhost".to_string())
}

// ── Config handlers ───────────────────────────────────────────────────

async fn get_config(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match use_stream_deck_config(&state).await {
        Ok(cfg) => (StatusCode::OK, Json(json!(cfg))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))).into_response(),
    }
}

async fn put_config(
    State(state): State<Arc<AppState>>,
    Json(body): Json<StreamDeckConfig>,
) -> impl IntoResponse {
    match save_stream_deck_config(&state, &body).await {
        Ok(_) => Json(json!({"ok": true})).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))).into_response(),
    }
}

async fn get_default_config_handler() -> impl IntoResponse {
    Json(json!(default_config()))
}

// ── Profile handlers ──────────────────────────────────────────────────

async fn list_profiles_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match list_profiles(&state).await {
        Ok(p) => Json(json!(p)).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))).into_response(),
    }
}

#[derive(Deserialize)]
struct NameBody { name: String }

async fn create_profile_handler(
    State(state): State<Arc<AppState>>,
    Json(body): Json<NameBody>,
) -> impl IntoResponse {
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "name required"}))).into_response();
    }
    match create_profile(&state, &name, None).await
        .and(activate_profile(&state, &name).await)
    {
        Ok(_) => Json(json!({"ok": true, "name": name})).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({"error": e}))).into_response(),
    }
}

async fn activate_profile_handler(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let name = urlencoding::decode(&name).unwrap_or_default().into_owned();
    match activate_profile(&state, &name).await {
        Ok(_) => Json(json!({"ok": true})).into_response(),
        Err(e) => (StatusCode::NOT_FOUND, Json(json!({"error": e}))).into_response(),
    }
}

#[derive(Deserialize)]
struct RenameBody { #[serde(rename = "newName")] new_name: String }

async fn rename_profile_handler(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Json(body): Json<RenameBody>,
) -> impl IntoResponse {
    let old = urlencoding::decode(&name).unwrap_or_default().into_owned();
    let new = body.new_name.trim().to_string();
    if new.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "newName required"}))).into_response();
    }
    match rename_profile(&state, &old, &new).await {
        Ok(_) => Json(json!({"ok": true, "name": new})).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({"error": e}))).into_response(),
    }
}

async fn delete_profile_handler(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let name = urlencoding::decode(&name).unwrap_or_default().into_owned();
    match delete_profile(&state, &name).await {
        Ok(_) => Json(json!({"ok": true})).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({"error": e}))).into_response(),
    }
}

// ── System handlers ───────────────────────────────────────────────────

#[derive(Deserialize)]
struct ExecuteBody { action: String, target: String }

async fn execute_handler(Json(body): Json<ExecuteBody>) -> impl IntoResponse {
    match crate::commands::system::execute_command(body.action, body.target).await {
        Ok(_) => Json(json!({"success": true})).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"success": false, "message": e}))).into_response(),
    }
}

#[derive(Deserialize)]
struct AppBody { #[serde(rename = "appName")] app_name: String }

async fn open_app_handler(Json(body): Json<AppBody>) -> impl IntoResponse {
    match crate::commands::system::open_app(body.app_name).await {
        Ok(_) => Json(json!({"success": true})).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"success": false, "message": e}))).into_response(),
    }
}

#[derive(Deserialize)]
struct UrlBody { url: String }

async fn open_url_handler(Json(body): Json<UrlBody>) -> impl IntoResponse {
    match crate::commands::system::open_url(body.url).await {
        Ok(_) => Json(json!({"success": true})).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"success": false, "message": e}))).into_response(),
    }
}

async fn open_config_folder_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let dir = state.config_dir.to_string_lossy().to_string();
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(&dir).spawn();
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("explorer").arg(&dir).spawn();
    #[cfg(target_os = "linux")]
    let _ = std::process::Command::new("xdg-open").arg(&dir).spawn();
    Json(json!({"ok": true}))
}

// ── Version handlers ──────────────────────────────────────────────────

async fn version_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match get_version_info_inner(&state).await {
        Ok(v) => Json(json!(v)).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))).into_response(),
    }
}

async fn check_update_handler() -> impl IntoResponse {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))).into_response(),
    };
    let url = "https://api.github.com/repos/mike623/panna-cotta/releases/latest";
    match client.get(url).header("User-Agent", "panna-cotta").send().await {
        Ok(r) if r.status().is_success() => {
            match r.json::<Value>().await {
                Ok(data) => Json(json!({
                    "version": data["tag_name"],
                    "name": data["name"],
                    "url": data["html_url"],
                    "assets": data["assets"].as_array().unwrap_or(&vec![]).iter().map(|a| json!({"name": a["name"], "url": a["browser_download_url"]})).collect::<Vec<_>>()
                })).into_response(),
                Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))).into_response(),
            }
        }
        _ => (StatusCode::BAD_GATEWAY, Json(json!({"error": "GitHub API error"}))).into_response(),
    }
}
```

- [ ] **Step 2: Add `urlencoding` to Cargo.toml**

Add to `[dependencies]` in `Cargo.toml`:
```toml
urlencoding = "2"
```

- [ ] **Step 3: Extract `get_version_info_inner` from version.rs**

In `packages/desktop/src-tauri/src/commands/version.rs`, extract the inner logic so both the Tauri command and the Axum route can call it. Rename the existing logic to `get_version_info_inner` and keep the Tauri command as a thin wrapper:

```rust
// Replace the existing get_version_info command with:

pub async fn get_version_info_inner(state: &AppState) -> Result<VersionInfo, String> {
    let needs_refresh = {
        let cache = state.version_cache.lock().map_err(|e| e.to_string())?;
        cache.as_ref().map_or(true, |c| c.fetched_at.elapsed() > CACHE_TTL)
    };
    if needs_refresh {
        if let Some(fresh) = fetch_latest().await {
            *state.version_cache.lock().map_err(|e| e.to_string())? = Some(fresh);
        }
    }
    let cache = state.version_cache.lock().map_err(|e| e.to_string())?;
    let latest = cache.as_ref().map(|c| c.latest.clone());
    let release_url = cache.as_ref().map(|c| c.release_url.clone());
    let update_available = latest.as_deref().map_or(false, |l| is_newer(l, CURRENT_VERSION));
    Ok(VersionInfo { current: CURRENT_VERSION.to_string(), latest, update_available, release_url })
}

#[tauri::command]
pub async fn get_version_info(state: State<'_, Arc<AppState>>) -> Result<VersionInfo, String> {
    get_version_info_inner(&state).await
}
```

- [ ] **Step 4: Verify compilation**

```bash
cd packages/desktop/src-tauri && cargo check 2>&1
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src-tauri/src/
git commit -m "feat: implement all Axum route handlers for LAN API"
```

---

### Task 10: Refactor app.rs — wire Axum + Tauri commands

**Files:**
- Modify: `packages/desktop/src-tauri/src/app.rs`
- Modify: `packages/desktop/src-tauri/src/lib.rs`

- [ ] **Step 1: Read current app.rs**

```bash
cat packages/desktop/src-tauri/src/app.rs
```

- [ ] **Step 2: Replace app.rs**

```rust
// packages/desktop/src-tauri/src/app.rs
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, Wry,
};
use tauri_plugin_autostart::MacosLauncher;
use crate::server::state::AppState;

pub struct TrayState {
    pub menu: Option<Menu<Wry>>,
}

fn update_tray_status(app: &AppHandle, menu: &Option<Menu<Wry>>, port: Option<u16>, running: bool) {
    let Some(menu) = menu else { return };
    let port_text = port.map_or("Port: --".to_string(), |p| format!("Port: {p}"));
    let status_text = if running { "● Running" } else { "○ Stopped" };
    if let Some(item) = menu.get("port") {
        if let Some(m) = item.as_menuitem() { let _ = m.set_text(&port_text); }
    }
    if let Some(item) = menu.get("status") {
        if let Some(m) = item.as_menuitem() { let _ = m.set_text(status_text); }
    }
    if let Some(tray) = app.tray_by_id("main") {
        let tooltip = format!("Panna Cotta — {}", if running { &port_text } else { "Stopped" });
        let _ = tray.set_tooltip(Some(&tooltip));
    }
}

pub fn toggle_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.show();
            let _ = w.set_focus();
        }
    } else {
        open_main_window(app);
    }
}

fn open_main_window(app: &AppHandle) {
    let port = app
        .state::<Arc<AppState>>()
        .port.lock().ok()
        .and_then(|p| *p)
        .unwrap_or(30000);
    if let Ok(url) = format!("http://localhost:{port}/apps/").parse() {
        let _ = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
            .title("Panna Cotta")
            .inner_size(420.0, 680.0)
            .decorations(false)
            .skip_taskbar(true)
            .build();
    }
}

fn open_admin(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("admin") {
        let _ = w.show();
        let _ = w.set_focus();
    } else {
        let _ = WebviewWindowBuilder::new(
            app,
            "admin",
            WebviewUrl::App(std::path::PathBuf::from("index.html")),
        )
        .title("Panna Cotta — Admin")
        .inner_size(760.0, 600.0)
        .decorations(true)
        .build();
    }
}

fn open_qr_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("qr") {
        let _ = w.show();
        let _ = w.set_focus();
    } else {
        let _ = WebviewWindowBuilder::new(
            app,
            "qr",
            WebviewUrl::App(std::path::PathBuf::from("qr.html")),
        )
        .title("Panna Cotta — QR Code")
        .inner_size(320.0, 420.0)
        .resizable(false)
        .decorations(true)
        .build();
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri_plugin_autostart::ManagerExt;
    let is_autostart = app.autolaunch().is_enabled().unwrap_or(false);

    let open = MenuItemBuilder::new("Open").id("open").build(app)?;
    let admin = MenuItemBuilder::new("Admin Config…").id("admin").build(app)?;
    let qr = MenuItemBuilder::new("Show QR Code").id("qr").build(app)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let port_item = MenuItemBuilder::new("Port: --").id("port").enabled(false).build(app)?;
    let status_item = MenuItemBuilder::new("○ Starting…").id("status").enabled(false).build(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let autostart = CheckMenuItem::with_id(app, "autostart", "Launch at Login", true, is_autostart, None::<&str>)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let version_str = format!("v{}", app.package_info().version);
    let version_item = MenuItemBuilder::new(version_str).id("version").enabled(false).build(app)?;
    let quit = MenuItemBuilder::new("Quit").id("quit").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&open).item(&admin).item(&qr).item(&sep1)
        .item(&port_item).item(&status_item).item(&sep2)
        .item(&autostart).item(&sep3).item(&version_item).item(&quit)
        .build()?;

    app.state::<Mutex<TrayState>>()
        .lock().unwrap().menu = Some(menu.clone());

    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))
        .map_err(|e| tauri::Error::InvalidIcon(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .icon_as_template(true)
        .menu(&menu)
        .on_menu_event(|app, event| handle_menu_event(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                toggle_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

fn handle_menu_event(app: &AppHandle, id: &str) {
    match id {
        "open" => toggle_window(app),
        "admin" => open_admin(app),
        "qr" => open_qr_window(app),
        "autostart" => {
            use tauri_plugin_autostart::ManagerExt;
            let al = app.autolaunch();
            if al.is_enabled().unwrap_or(false) { let _ = al.disable(); } else { let _ = al.enable(); }
        }
        "quit" => app.exit(0),
        _ => {}
    }
}

pub fn run() {
    let app_state = Arc::new(AppState::new());
    let tray_state = Mutex::new(TrayState { menu: None });

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![])))
        .manage(app_state.clone())
        .manage(tray_state)
        .invoke_handler(tauri::generate_handler![
            crate::commands::config::get_config,
            crate::commands::config::save_config,
            crate::commands::config::get_default_config,
            crate::commands::config::list_profiles_cmd,
            crate::commands::config::create_profile_cmd,
            crate::commands::config::activate_profile_cmd,
            crate::commands::config::rename_profile_cmd,
            crate::commands::config::delete_profile_cmd,
            crate::commands::config::open_config_folder,
            crate::commands::system::execute_command,
            crate::commands::system::open_app,
            crate::commands::system::open_url,
            crate::commands::version::get_version_info,
            crate::commands::server_info::get_server_info,
        ])
        .setup(move |app| {
            build_tray(app.handle())?;

            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let app_handle = app.handle().clone();
            let state = app_state.clone();

            tauri::async_runtime::spawn(async move {
                match crate::server::start(state.clone()).await {
                    Ok(port) => {
                        let tray_state = app_handle.state::<Mutex<TrayState>>();
                        let menu = tray_state.lock().unwrap().menu.clone();
                        update_tray_status(&app_handle, &menu, Some(port), true);
                    }
                    Err(e) => eprintln!("Server failed to start: {e}"),
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error running Tauri app");
}
```

- [ ] **Step 3: Update lib.rs to expose TrayState**

```rust
// packages/desktop/src-tauri/src/lib.rs
pub mod app;
pub mod commands;
pub mod server;
```

- [ ] **Step 4: Verify compilation**

```bash
cd packages/desktop/src-tauri && cargo check 2>&1
```
Expected: no errors. Fix any import issues that arise.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src-tauri/src/app.rs packages/desktop/src-tauri/src/lib.rs
git commit -m "feat: refactor app.rs to use Axum server and Tauri commands, remove sidecar"
```

---

### Task 11: Update tauri.conf.json and capabilities

**Files:**
- Modify: `packages/desktop/src-tauri/tauri.conf.json`
- Modify: `packages/desktop/src-tauri/capabilities/default.json`

- [ ] **Step 1: Update tauri.conf.json**

Replace the contents of `packages/desktop/src-tauri/tauri.conf.json`:

```json
{
  "productName": "Panna Cotta",
  "version": "0.1.5",
  "identifier": "io.mwong.panna-cotta",
  "build": {
    "beforeBuildCommand": "npm run build",
    "frontendDist": "frontend/dist"
  },
  "app": {
    "withGlobalTauri": true,
    "windows": [],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

Note: `windows: []` — all windows are created programmatically in `app.rs`.

- [ ] **Step 2: Update capabilities**

Replace `packages/desktop/src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "default capability",
  "windows": ["main", "admin", "qr"],
  "permissions": [
    "core:default",
    "autostart:allow-enable",
    "autostart:allow-disable",
    "autostart:allow-is-enabled"
  ]
}
```

- [ ] **Step 3: Create the placeholder frontend/dist directory**

```bash
mkdir -p packages/desktop/src-tauri/frontend/dist
echo "placeholder" > packages/desktop/src-tauri/frontend/dist/.gitkeep
```

- [ ] **Step 4: Verify cargo check still passes**

```bash
cd packages/desktop/src-tauri && cargo check 2>&1
```

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src-tauri/tauri.conf.json packages/desktop/src-tauri/capabilities/ packages/desktop/src-tauri/frontend/
git commit -m "chore: update tauri.conf.json (remove sidecar, set frontendDist) and capabilities"
```

---

## Phase 2 — Svelte Admin UI

### Task 12: Scaffold Svelte project

**Files:**
- Modify: `packages/desktop/package.json`
- Create: `packages/desktop/vite.config.ts`
- Create: `packages/desktop/svelte.config.js`
- Create: `packages/desktop/index.html`
- Create: `packages/desktop/src/main.ts`
- Create: `packages/desktop/src/app.css`

- [ ] **Step 1: Update package.json**

```json
{
  "name": "panna-cotta-desktop",
  "version": "0.1.5",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "tauri": "tauri"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.0.0"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^3.0.0",
    "@tauri-apps/cli": "^2",
    "svelte": "^4.0.0",
    "vite": "^5.0.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
cd packages/desktop && npm install 2>&1
```
Expected: `node_modules/` created, no errors.

- [ ] **Step 3: Create vite.config.ts**

```typescript
// packages/desktop/vite.config.ts
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  plugins: [svelte()],
  build: {
    outDir: 'src-tauri/frontend/dist',
    emptyOutDir: true,
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
})
```

- [ ] **Step 4: Create svelte.config.js**

```javascript
// packages/desktop/svelte.config.js
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'
export default { preprocess: vitePreprocess() }
```

- [ ] **Step 5: Create index.html**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Panna Cotta — Admin</title>
    <meta name="color-scheme" content="dark" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 6: Create src/main.ts and app.css**

```typescript
// packages/desktop/src/main.ts
import App from './App.svelte'
const app = new App({ target: document.getElementById('app')! })
export default app
```

```css
/* packages/desktop/src/app.css */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: system-ui, -apple-system, sans-serif;
  background: #1c1c1e;
  color: #f0f0f0;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
```

- [ ] **Step 7: Create minimal App.svelte to verify build**

```svelte
<!-- packages/desktop/src/App.svelte -->
<script lang="ts">
  import './app.css'
</script>
<div>Loading…</div>
```

- [ ] **Step 8: Verify Vite build succeeds**

```bash
cd packages/desktop && npm run build 2>&1
```
Expected: `src-tauri/frontend/dist/` populated with `index.html` and assets.

- [ ] **Step 9: Commit**

```bash
git add packages/desktop/
git commit -m "feat: scaffold Svelte + Vite project for admin UI"
```

---

### Task 13: IPC layer — types and invoke wrappers

**Files:**
- Create: `packages/desktop/src/lib/types.ts`
- Create: `packages/desktop/src/lib/invoke.ts`

- [ ] **Step 1: Create types.ts**

```typescript
// packages/desktop/src/lib/types.ts
export interface Button {
  name: string
  type: 'browser' | 'system'
  icon: string
  action: string
}

export interface Grid {
  rows: number
  cols: number
}

export interface StreamDeckConfig {
  grid: Grid
  buttons: Button[]
}

export interface Profile {
  name: string
  isActive: boolean
}

export interface VersionInfo {
  current: string
  latest: string | null
  updateAvailable: boolean
  releaseUrl: string | null
}

export interface ServerInfo {
  ip: string
  port: number
}
```

- [ ] **Step 2: Create invoke.ts**

```typescript
// packages/desktop/src/lib/invoke.ts
import { invoke } from '@tauri-apps/api/core'
import type { StreamDeckConfig, Profile, VersionInfo, ServerInfo } from './types'

export const getConfig = () =>
  invoke<StreamDeckConfig>('get_config')

export const saveConfig = (config: StreamDeckConfig) =>
  invoke<void>('save_config', { config })

export const getDefaultConfig = () =>
  invoke<StreamDeckConfig>('get_default_config')

export const listProfiles = () =>
  invoke<Profile[]>('list_profiles_cmd')

export const createProfile = (name: string) =>
  invoke<void>('create_profile_cmd', { name })

export const activateProfile = (name: string) =>
  invoke<void>('activate_profile_cmd', { name })

export const renameProfile = (oldName: string, newName: string) =>
  invoke<void>('rename_profile_cmd', { oldName, newName })

export const deleteProfile = (name: string) =>
  invoke<void>('delete_profile_cmd', { name })

export const openConfigFolder = () =>
  invoke<void>('open_config_folder')

export const getVersionInfo = () =>
  invoke<VersionInfo>('get_version_info')

export const executeCommand = (action: string, target: string) =>
  invoke<void>('execute_command', { action, target })

export const openApp = (appName: string) =>
  invoke<void>('open_app', { appName })

export const openUrl = (url: string) =>
  invoke<void>('open_url', { url })

export const getServerInfo = () =>
  invoke<ServerInfo>('get_server_info')
```

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/lib/
git commit -m "feat: add typed Tauri IPC layer (types.ts + invoke.ts)"
```

---

### Task 14: ProfileSelector component

**Files:**
- Create: `packages/desktop/src/components/ProfileSelector.svelte`

- [ ] **Step 1: Create component**

```svelte
<!-- packages/desktop/src/components/ProfileSelector.svelte -->
<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import { activateProfile, createProfile, deleteProfile, renameProfile } from '../lib/invoke'
  import type { Profile } from '../lib/types'

  export let profiles: Profile[] = []

  const dispatch = createEventDispatcher<{
    change: void
    toast: { message: string; ok: boolean }
  }>()

  function toast(message: string, ok: boolean) {
    dispatch('toast', { message, ok })
  }

  async function handleSwitch(name: string) {
    await activateProfile(name).catch(e => toast(String(e), false))
    dispatch('change')
  }

  async function handleNew() {
    const name = prompt('New profile name:')?.trim()
    if (!name) return
    await createProfile(name).catch(e => toast(String(e), false))
    dispatch('change')
  }

  async function handleRename() {
    const current = profiles.find(p => p.isActive)?.name
    if (!current) return
    const newName = prompt(`Rename "${current}" to:`)?.trim()
    if (!newName || newName === current) return
    await renameProfile(current, newName).catch(e => toast(String(e), false))
    dispatch('change')
  }

  async function handleDelete() {
    const current = profiles.find(p => p.isActive)?.name
    if (!current || !confirm(`Delete profile "${current}"? This cannot be undone.`)) return
    await deleteProfile(current).catch(e => toast(String(e), false))
    dispatch('change')
  }
</script>

<div class="profile-section">
  <select class="profile-select" on:change={e => handleSwitch(e.currentTarget.value)}>
    {#each profiles as profile}
      <option value={profile.name} selected={profile.isActive}>{profile.name}</option>
    {/each}
  </select>
  <button class="icon-btn" on:click={handleNew} title="New profile">+</button>
  <button class="icon-btn" on:click={handleRename} title="Rename profile">✎</button>
  <button class="icon-btn" on:click={handleDelete} title="Delete profile">×</button>
</div>

<style>
  .profile-section { display: flex; align-items: center; gap: 0.3rem; margin-left: 0.5rem; }
  .profile-select {
    background: #2a2a2c; border: 1px solid #3a3a3c; color: #f0f0f0;
    padding: 0.28rem 0.5rem; border-radius: 0.35rem; font-size: 0.8rem;
    cursor: pointer; max-width: 120px;
  }
  .icon-btn {
    background: #2a2a2c; border: 1px solid #3a3a3c; color: #aaa;
    padding: 0.28rem 0.55rem; border-radius: 0.35rem; cursor: pointer;
    font-size: 0.75rem; line-height: 1;
  }
  .icon-btn:hover { background: #3a3a3c; color: #f0f0f0; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add packages/desktop/src/components/ProfileSelector.svelte
git commit -m "feat: add ProfileSelector Svelte component"
```

---

### Task 15: GridEditor component

**Files:**
- Create: `packages/desktop/src/components/GridEditor.svelte`

- [ ] **Step 1: Create component**

```svelte
<!-- packages/desktop/src/components/GridEditor.svelte -->
<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import type { StreamDeckConfig } from '../lib/types'

  export let config: StreamDeckConfig
  export let selectedIndex: number = -1

  const dispatch = createEventDispatcher<{ select: number }>()

  const ICON_MAP: Record<string, string> = {
    github:'⬡', link:'🔗', globe:'🌐', chrome:'🌐', terminal:'🖥',
    'volume-2':'🔊', 'volume-1':'🔉', 'volume-x':'🔇', sun:'☀️', moon:'🌙',
    power:'⏻', lock:'🔒', calculator:'🧮', youtube:'▶', twitch:'📺',
    reddit:'🔴', mail:'✉️', spotify:'♫', discord:'💬', code:'</>',
  }

  function iconEmoji(name: string): string {
    return ICON_MAP[name] ?? (name ? name.slice(0, 2).toUpperCase() : '?')
  }

  $: rows = config.grid.rows
  $: cols = config.grid.cols
  $: total = rows * cols
  $: cells = Array.from({ length: total }, (_, i) => config.buttons[i] ?? null)
</script>

<div class="grid-settings">
  <span class="section-label">Grid</span>
  <span class="dim">Rows</span>
  <input type="number" min="1" max="10" bind:value={config.grid.rows} />
  <span class="dim">Cols</span>
  <input type="number" min="1" max="10" bind:value={config.grid.cols} />
</div>

<div class="grid-preview" style="grid-template-columns: repeat({cols}, 72px)">
  {#each cells as btn, i}
    <button
      class="grid-cell"
      class:empty={!btn}
      class:selected={selectedIndex === i}
      on:click={() => dispatch('select', i)}
    >
      {#if btn}
        <span class="cell-icon">{iconEmoji(btn.icon)}</span>
        <span class="cell-label">{btn.name}</span>
      {:else}
        <span class="cell-icon" style="opacity:0.4;font-size:1.1rem">+</span>
      {/if}
      <span class="cell-idx">{i + 1}</span>
    </button>
  {/each}
</div>

<style>
  .grid-settings { display: flex; align-items: center; gap: 0.6rem; font-size: 0.8rem; color: #888; }
  .section-label { font-size: 0.7rem; color: #666; text-transform: uppercase; letter-spacing: 0.07em; font-weight: 600; }
  .dim { color: #666; }
  input { background: #2a2a2c; border: 1px solid #3a3a3c; color: #f0f0f0; padding: 0.25rem 0.4rem; border-radius: 0.3rem; width: 3.2rem; font-size: 0.8rem; text-align: center; }
  .grid-preview { display: grid; gap: 0.45rem; background: #252527; padding: 0.875rem; border-radius: 0.6rem; width: fit-content; }
  .grid-cell {
    width: 72px; height: 72px; background: #3a3a3c; border-radius: 0.5rem;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 3px; cursor: pointer; border: 2px solid transparent;
    transition: border-color 0.1s, background 0.1s;
    overflow: hidden; padding: 4px; position: relative;
  }
  .grid-cell:hover { background: #464648; }
  .grid-cell.selected { border-color: #4f46e5; background: #1e1a3a; }
  .grid-cell.empty { opacity: 0.35; }
  .grid-cell.empty:hover { opacity: 0.6; }
  .cell-icon { font-size: 1.5rem; line-height: 1; }
  .cell-label { font-size: 0.58rem; color: #ccc; text-align: center; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; max-width: 66px; }
  .cell-idx { position: absolute; top: 3px; right: 4px; font-size: 0.5rem; color: #555; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add packages/desktop/src/components/GridEditor.svelte
git commit -m "feat: add GridEditor Svelte component"
```

---

### Task 16: ButtonEditor component

**Files:**
- Create: `packages/desktop/src/components/ButtonEditor.svelte`

- [ ] **Step 1: Create component**

```svelte
<!-- packages/desktop/src/components/ButtonEditor.svelte -->
<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import { saveConfig } from '../lib/invoke'
  import type { Button, StreamDeckConfig } from '../lib/types'

  export let config: StreamDeckConfig
  export let selectedIndex: number = -1

  const dispatch = createEventDispatcher<{
    save: void
    toast: { message: string; ok: boolean }
  }>()

  let name = ''
  let type: 'browser' | 'system' = 'browser'
  let icon = ''
  let action = ''

  $: selectedBtn = selectedIndex >= 0 ? (config.buttons[selectedIndex] ?? null) : null
  $: isEditing = selectedBtn !== null

  $: if (selectedIndex >= 0) {
    const btn = config.buttons[selectedIndex]
    if (btn) {
      name = btn.name; type = btn.type as 'browser' | 'system'; icon = btn.icon; action = btn.action
    } else {
      name = ''; type = 'browser'; icon = ''; action = ''
    }
  }

  export function prefill(btn: Partial<Button>) {
    if (btn.name !== undefined) name = btn.name
    if (btn.type !== undefined) type = btn.type as 'browser' | 'system'
    if (btn.icon !== undefined) icon = btn.icon
    if (btn.action !== undefined) action = btn.action
  }

  function toast(message: string, ok: boolean) { dispatch('toast', { message, ok }) }

  async function handleSave() {
    if (!name.trim() || !icon.trim() || !action.trim()) {
      toast('Fill in all fields', false); return
    }
    const btn: Button = { name: name.trim(), type, icon: icon.trim(), action: action.trim() }
    const newButtons = [...config.buttons]
    if (selectedIndex >= 0) {
      while (newButtons.length <= selectedIndex) newButtons.push(null as unknown as Button)
      newButtons[selectedIndex] = btn
    } else {
      newButtons.push(btn)
    }
    await saveConfig({ ...config, buttons: newButtons.filter(Boolean) })
      .then(() => { toast('Saved!', true); dispatch('save') })
      .catch(e => toast(String(e), false))
  }

  async function handleDelete() {
    if (selectedIndex < 0) return
    const newButtons = config.buttons.filter((_, i) => i !== selectedIndex)
    await saveConfig({ ...config, buttons: newButtons })
      .then(() => { toast('Deleted', true); dispatch('save') })
      .catch(e => toast(String(e), false))
  }

  function handleClear() {
    name = ''; type = 'browser'; icon = ''; action = ''
  }
</script>

<div class="editor-panel">
  <div class="editor-header">
    <span class="editor-title">
      {isEditing ? `Edit: ${selectedBtn?.name ?? ''}` : selectedIndex >= 0 ? `Add to slot ${selectedIndex + 1}` : 'Add Button'}
    </span>
  </div>
  <div class="editor-fields">
    <div class="field"><label>Name</label><input bind:value={name} placeholder="GitHub" /></div>
    <div class="field">
      <label>Type</label>
      <select bind:value={type}>
        <option value="browser">browser</option>
        <option value="system">system</option>
      </select>
    </div>
    <div class="field"><label>Icon (Lucide name)</label><input bind:value={icon} placeholder="github" /></div>
    <div class="field full"><label>Action (URL or app name)</label><input bind:value={action} placeholder="https://github.com" /></div>
  </div>
  <div class="editor-actions">
    <button class="btn" on:click={handleSave}>{isEditing ? 'Update' : 'Add'}</button>
    <button class="btn secondary" on:click={handleClear}>Clear</button>
    {#if isEditing}
      <button class="btn danger" on:click={handleDelete}>Delete</button>
    {/if}
  </div>
</div>

<style>
  .editor-panel { background: #252527; border-radius: 0.6rem; padding: 0.75rem; }
  .editor-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.6rem; }
  .editor-title { font-size: 0.75rem; color: #888; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
  .editor-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
  .field { display: flex; flex-direction: column; gap: 0.2rem; }
  .field label { font-size: 0.7rem; color: #777; }
  .field input, .field select { background: #1c1c1e; border: 1px solid #3a3a3c; color: #f0f0f0; padding: 0.32rem 0.55rem; border-radius: 0.35rem; font-size: 0.82rem; width: 100%; }
  .field input:focus, .field select:focus { outline: 1px solid #4f46e5; border-color: #4f46e5; }
  .field.full { grid-column: 1/-1; }
  .editor-actions { display: flex; gap: 0.4rem; margin-top: 0.55rem; }
  .btn { background: #4f46e5; color: #fff; border: none; padding: 0.35rem 0.85rem; border-radius: 0.35rem; cursor: pointer; font-size: 0.8rem; }
  .btn:hover { background: #6366f1; }
  .btn.secondary { background: #2a2a2c; border: 1px solid #3a3a3c; color: #ccc; }
  .btn.secondary:hover { background: #3a3a3c; color: #f0f0f0; }
  .btn.danger { background: transparent; color: #f87171; border: 1px solid #3a3a3c; }
  .btn.danger:hover { background: #2e1a1a; border-color: #f87171; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add packages/desktop/src/components/ButtonEditor.svelte
git commit -m "feat: add ButtonEditor Svelte component"
```

---

### Task 17: ActionSidebar component

**Files:**
- Create: `packages/desktop/src/components/ActionSidebar.svelte`

- [ ] **Step 1: Create component**

```svelte
<!-- packages/desktop/src/components/ActionSidebar.svelte -->
<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import type { Button } from '../lib/types'

  const dispatch = createEventDispatcher<{ use: Partial<Button> }>()

  let query = ''

  const ACTION_GROUPS = [
    { name: 'Browser', icon: '🌐', items: [
      { name: 'Open URL', icon: '🔗', type: 'browser' as const, action: 'https://', iconName: 'link' },
    ]},
    { name: 'System', icon: '⚙️', items: [
      { name: 'Open App', icon: '🖥', type: 'system' as const, action: '', iconName: 'terminal' },
      { name: 'Volume Up', icon: '🔊', type: 'system' as const, action: 'volume-up', iconName: 'volume-2' },
      { name: 'Volume Down', icon: '🔉', type: 'system' as const, action: 'volume-down', iconName: 'volume-1' },
      { name: 'Mute Toggle', icon: '🔇', type: 'system' as const, action: 'volume-mute', iconName: 'volume-x' },
      { name: 'Brightness Up', icon: '☀️', type: 'system' as const, action: 'brightness-up', iconName: 'sun' },
      { name: 'Brightness Down', icon: '🌙', type: 'system' as const, action: 'brightness-down', iconName: 'moon' },
      { name: 'Sleep', icon: '💤', type: 'system' as const, action: 'sleep', iconName: 'power' },
      { name: 'Lock Screen', icon: '🔒', type: 'system' as const, action: 'lock', iconName: 'lock' },
    ]},
  ]

  $: filtered = ACTION_GROUPS.map(g => ({
    ...g,
    items: query
      ? g.items.filter(i => i.name.toLowerCase().includes(query.toLowerCase()))
      : g.items,
  })).filter(g => g.items.length > 0)
</script>

<div class="right-panel">
  <div class="right-header">
    <input class="search-input" type="search" placeholder="Search actions…" bind:value={query} />
  </div>
  <div class="actions-list">
    {#each filtered as group}
      <div class="action-group">
        <div class="action-group-header">{group.icon} {group.name}</div>
        <div class="action-group-items">
          {#each group.items as item}
            <button
              class="action-item"
              on:click={() => dispatch('use', { name: item.name, type: item.type, icon: item.iconName, action: item.action })}
            >
              <span class="action-item-icon">{item.icon}</span>
              {item.name}
            </button>
          {/each}
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .right-panel { width: 220px; border-left: 1px solid #3a3a3c; display: flex; flex-direction: column; overflow: hidden; flex-shrink: 0; }
  .right-header { padding: 0.65rem 0.65rem 0.5rem; flex-shrink: 0; border-bottom: 1px solid #3a3a3c; }
  .search-input { width: 100%; background: #2a2a2c; border: 1px solid #3a3a3c; color: #f0f0f0; padding: 0.35rem 0.65rem; border-radius: 0.35rem; font-size: 0.8rem; }
  .search-input::placeholder { color: #555; }
  .search-input:focus { outline: 1px solid #4f46e5; border-color: #4f46e5; }
  .actions-list { flex: 1; overflow-y: auto; padding: 0.4rem 0.4rem 0.75rem; }
  .action-group { margin-top: 0.35rem; }
  .action-group-header { display: flex; align-items: center; gap: 0.35rem; font-size: 0.68rem; font-weight: 700; color: #666; text-transform: uppercase; letter-spacing: 0.07em; padding: 0.35rem 0.4rem 0.2rem; }
  .action-group-items { display: flex; flex-direction: column; gap: 1px; }
  .action-item { display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 0.6rem; border-radius: 0.35rem; font-size: 0.8rem; color: #bbb; cursor: pointer; background: none; border: none; width: 100%; text-align: left; }
  .action-item:hover { background: #2a2a2c; color: #f0f0f0; }
  .action-item-icon { width: 1.1rem; text-align: center; font-size: 0.9rem; flex-shrink: 0; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add packages/desktop/src/components/ActionSidebar.svelte
git commit -m "feat: add ActionSidebar Svelte component"
```

---

### Task 18: App.svelte root + wire end-to-end

**Files:**
- Modify: `packages/desktop/src/App.svelte`

- [ ] **Step 1: Write App.svelte**

```svelte
<!-- packages/desktop/src/App.svelte -->
<script lang="ts">
  import { onMount } from 'svelte'
  import './app.css'
  import ProfileSelector from './components/ProfileSelector.svelte'
  import GridEditor from './components/GridEditor.svelte'
  import ButtonEditor from './components/ButtonEditor.svelte'
  import ActionSidebar from './components/ActionSidebar.svelte'
  import { getConfig, getDefaultConfig, listProfiles, openConfigFolder } from './lib/invoke'
  import type { StreamDeckConfig, Profile } from './lib/types'

  let config: StreamDeckConfig | null = null
  let profiles: Profile[] = []
  let selectedIndex = -1
  let toastMsg = ''
  let toastOk = true
  let toastVisible = false
  let toastTimer: ReturnType<typeof setTimeout>
  let editorRef: ButtonEditor

  function showToast(message: string, ok: boolean) {
    toastMsg = message; toastOk = ok; toastVisible = true
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { toastVisible = false }, 2500)
  }

  async function reload() {
    const [cfg, profs] = await Promise.all([getConfig(), listProfiles()])
    config = cfg
    profiles = profs
    selectedIndex = -1
  }

  async function handleReset() {
    if (!confirm('Reset to defaults? This overwrites the current profile.')) return
    config = await getDefaultConfig()
    showToast('Defaults loaded — click Save to apply', true)
  }

  onMount(reload)
</script>

<div class="topbar">
  <span class="app-title">Panna Cotta</span>
  <ProfileSelector
    {profiles}
    on:change={reload}
    on:toast={e => showToast(e.detail.message, e.detail.ok)}
  />
  <div class="spacer"></div>
  <button class="btn secondary" on:click={openConfigFolder}>📂 Config Folder</button>
  <button class="btn secondary" on:click={handleReset}>Reset</button>
</div>

{#if config}
  <div class="main">
    <div class="left-panel">
      <GridEditor
        {config}
        {selectedIndex}
        on:select={e => { selectedIndex = e.detail }}
      />
      <div class="divider"></div>
      <ButtonEditor
        bind:this={editorRef}
        {config}
        {selectedIndex}
        on:save={reload}
        on:toast={e => showToast(e.detail.message, e.detail.ok)}
      />
    </div>
    <ActionSidebar
      on:use={e => editorRef?.prefill(e.detail)}
    />
  </div>
{/if}

{#if toastVisible}
  <div class="toast-bar" class:ok={toastOk} class:err={!toastOk}>{toastMsg}</div>
{/if}

<style>
  .topbar { display: flex; align-items: center; gap: 0.6rem; padding: 0.55rem 1rem; background: #141416; border-bottom: 1px solid #3a3a3c; flex-shrink: 0; }
  .app-title { font-size: 0.9rem; font-weight: 600; white-space: nowrap; }
  .spacer { flex: 1; }
  .main { display: flex; flex: 1; overflow: hidden; }
  .left-panel { flex: 1; display: flex; flex-direction: column; overflow-y: auto; padding: 0.875rem; gap: 0.75rem; min-width: 0; }
  .divider { height: 1px; background: #3a3a3c; flex-shrink: 0; }
  .btn { background: #4f46e5; color: #fff; border: none; padding: 0.35rem 0.85rem; border-radius: 0.35rem; cursor: pointer; font-size: 0.8rem; white-space: nowrap; }
  .btn:hover { background: #6366f1; }
  .btn.secondary { background: #2a2a2c; border: 1px solid #3a3a3c; color: #ccc; }
  .btn.secondary:hover { background: #3a3a3c; color: #f0f0f0; }
  .toast-bar { position: fixed; bottom: 1rem; left: 50%; transform: translateX(-50%); background: #2a2a2c; border: 1px solid #3a3a3c; padding: 0.45rem 1.1rem; border-radius: 2rem; font-size: 0.82rem; white-space: nowrap; }
  .toast-bar.ok { border-color: #4ade80; color: #4ade80; }
  .toast-bar.err { border-color: #f87171; color: #f87171; }
</style>
```

- [ ] **Step 2: Build and verify no TypeScript errors**

```bash
cd packages/desktop && npm run build 2>&1
```
Expected: clean build, output in `src-tauri/frontend/dist/`.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/App.svelte
git commit -m "feat: wire App.svelte root component with all sub-components"
```

---

## Phase 3 — QR Window + Cleanup

### Task 19: QR window

**Files:**
- Create: `packages/desktop/public/qr.html`

- [ ] **Step 1: Create qr.html**

Vite copies files from `public/` verbatim to `dist/`. Create:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Panna Cotta — QR Code</title>
  <meta name="color-scheme" content="dark" />
  <style>
    body { font-family: system-ui, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #111; color: #eee; }
    .card { background: #1a1a2e; padding: 2rem; border-radius: 1rem; text-align: center; }
    h2 { margin: 0 0 1rem; font-size: 1.1rem; }
    img { border-radius: 0.5rem; }
    p { margin-top: 0.75rem; color: #aaa; font-size: 0.85rem; }
    code { background: #2a2a3e; padding: 0.2rem 0.4rem; border-radius: 0.2rem; }
    a { color: #818cf8; }
    .err { color: #f87171; margin-top: 1rem; }
  </style>
</head>
<body>
<div class="card">
  <h2>Scan to open Stream Deck</h2>
  <div id="content"><p>Loading…</p></div>
</div>
<script>
  const { invoke } = window.__TAURI__.core;
  async function load() {
    try {
      const { ip, port } = await invoke('get_server_info');
      const url = `http://${ip}:${port}/apps/`;
      const qr = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;
      document.getElementById('content').innerHTML =
        `<img src="${qr}" width="200" height="200" alt="QR Code" />`
        + `<p>Or open: <a href="${url}"><code>${url}</code></a></p>`;
    } catch (e) {
      document.getElementById('content').innerHTML = `<p class="err">Server not running: ${e}</p>`;
    }
  }
  load();
</script>
</body>
</html>
```

- [ ] **Step 2: Verify qr.html appears in dist after build**

```bash
cd packages/desktop && npm run build && ls src-tauri/frontend/dist/qr.html 2>&1
```
Expected: file exists.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/public/qr.html
git commit -m "feat: add QR window HTML for tray menu shortcut"
```

---

### Task 20: Delete Deno backend and sidecar artifacts

> **Warning:** This step permanently deletes `packages/backend/` and the sidecar binaries. Verify the Rust backend is working before proceeding (run `cargo check` and manually test LAN access).

- [ ] **Step 1: Verify Rust backend compiles cleanly**

```bash
cd packages/desktop/src-tauri && cargo check 2>&1
```
Expected: no errors.

- [ ] **Step 2: Verify Vite build succeeds**

```bash
cd packages/desktop && npm run build 2>&1
```
Expected: clean build.

- [ ] **Step 3: Delete Deno backend**

```bash
rm -rf packages/backend
```

- [ ] **Step 4: Delete sidecar binaries**

```bash
rm -rf packages/desktop/src-tauri/binaries
```

- [ ] **Step 5: Remove tauri-plugin-shell from Cargo.toml**

In `packages/desktop/src-tauri/Cargo.toml`, remove the line:
```toml
tauri-plugin-shell = "2"
```

- [ ] **Step 6: Remove shell plugin init from app.rs**

In `packages/desktop/src-tauri/src/app.rs`, remove these two lines from `run()`:
```rust
// Remove this:
.plugin(tauri_plugin_shell::init())
// and this import at the top if present:
use tauri_plugin_shell::ShellExt;
```

- [ ] **Step 7: Verify cargo check still passes**

```bash
cd packages/desktop/src-tauri && cargo check 2>&1
```

- [ ] **Step 8: Update root deno.json**

Remove backend-related tasks from the root `deno.json`. Keep only tasks that remain relevant (formatting of any remaining Deno files, or remove entirely if no Deno files remain). Read the file first:

```bash
cat deno.json
```

Remove tasks: `start:backend`, `start:backend:watch`, `compile`, `compile:sidecar:*`. If only `test`, `lint`, `fmt` remain and there are no more Deno source files, remove `deno.json` entirely.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: delete Deno backend, sidecar binaries, and shell plugin"
```

---

### Task 21: Update CI/release workflow

**Files:**
- Modify: `.github/workflows/` (read current files first)

- [ ] **Step 1: Read current workflow files**

```bash
ls .github/workflows/ && cat .github/workflows/*.yml 2>&1
```

- [ ] **Step 2: Remove Deno compile steps**

In each workflow file, remove any steps that:
- Use `denoland/setup-deno`
- Run `deno task compile` or `deno task compile:sidecar:*`
- Reference `binaries/stream-backend`

- [ ] **Step 3: Add npm install + Vite build step before Tauri build**

In the Tauri build job, add before the `tauri-action` step:

```yaml
- name: Install frontend dependencies
  run: npm install
  working-directory: packages/desktop

- name: Build Svelte admin
  run: npm run build
  working-directory: packages/desktop
```

- [ ] **Step 4: Verify workflow YAML is valid**

```bash
cat .github/workflows/*.yml | python3 -c "import sys, yaml; yaml.safe_load(sys.stdin.read()); print('YAML valid')" 2>&1
```

- [ ] **Step 5: Commit**

```bash
git add .github/
git commit -m "ci: replace Deno compile steps with Vite build in release workflow"
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ Single build artifact (Task 21 removes Deno, Task 10 wires Axum on startup)
- ✅ Admin UI as Svelte SPA (Tasks 12–18)
- ✅ LAN access preserved (Task 9 embeds `packages/frontend/` via `include_dir!`)
- ✅ Tauri commands for admin IPC (Tasks 5–7, 13)
- ✅ QR page on both HTTP and tray (Task 9 `qr_page` handler, Task 19 `qr.html`)
- ✅ Profile CRUD (Tasks 3–5)
- ✅ System commands (Task 6)
- ✅ Version check with cache (Task 7)
- ✅ Port resolution (Task 8)
- ✅ `tauri_plugin_autostart` kept (Task 11 capabilities, Task 10 app.rs)
- ✅ `tauri-plugin-shell` removed (Task 20)
- ✅ CI updated (Task 21)
- ✅ `get_server_info` command (Task 6)
