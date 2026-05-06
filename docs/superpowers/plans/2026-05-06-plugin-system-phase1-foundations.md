# Plugin System Phase 1 — Data Model & Security Foundations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the TOML-based Button model to the new JSON schema with `actionUUID`/`context`/`settings`, add CSRF security on admin routes, and refactor the execute endpoint to accept `{ context }` from LAN.

**Architecture:** Existing TOML profiles are migrated to JSON on first read (atomic tmp→rename, TOML backed up as `.toml.bak`). A 32-byte hex CSRF token is generated at startup in `AppState`; all mutating admin routes require `ConnectInfo` = localhost AND `X-Panna-CSRF` header. The execute route accepts `{ context }` from LAN (unauthenticated) with `lan_allowed` enforcement; legacy `{ action, target }` is localhost + CSRF only.

**Tech Stack:** Rust, axum 0.7, tokio, serde_json (JSON profiles), `nanoid = "0.4"` (context IDs), `rand = "0.8"` (CSRF token), `url = "2"` (scheme validation)

**Related spec:** `docs/superpowers/specs/2026-05-04-plugin-system-design.md`

**Multi-plan series:**
- **This plan (1/6):** Data model + security
- Plan 2/6: Plugin host + WebSocket + PI
- Plan 3/6: Node.js runtime lazy download
- Plan 4/6: Built-in TypeScript plugins
- Plan 5/6: Admin UI React components
- Plan 6/6: LAN frontend `{ context }` execute

---

## File Map

| File | Action |
|------|--------|
| `packages/desktop/src-tauri/Cargo.toml` | Add `url`, `rand`, `nanoid` deps |
| `packages/desktop/src-tauri/src/server/state.rs` | LegacyButton, new Button struct, context gen, JSON ops, migration |
| `packages/desktop/src-tauri/src/server/mod.rs` | `into_make_service_with_connect_info` |
| `packages/desktop/src-tauri/src/server/routes.rs` | CSRF middleware, execute refactor, config redaction, route gating |
| `packages/desktop/src-tauri/src/commands/system.rs` | `open_url`: add URL scheme validation |
| `packages/desktop/src-tauri/src/commands/config.rs` | Add `get_csrf_token` Tauri command |
| `packages/desktop/src/lib/types.ts` | Update `Button` interface |
| `packages/desktop/src/lib/invoke.ts` | Add `getCsrfToken` wrapper |

---

## Task 1: Add Cargo Dependencies

**Files:**
- Modify: `packages/desktop/src-tauri/Cargo.toml`

- [ ] **Step 1: Add three deps to `[dependencies]`**

Open `packages/desktop/src-tauri/Cargo.toml`. After the `urlencoding = "2"` line add:

```toml
url = "2"
rand = "0.8"
nanoid = "0.4"
```

- [ ] **Step 2: Verify compilation**

```bash
cd packages/desktop/src-tauri && cargo check
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src-tauri/Cargo.toml
git commit -m "chore: add url, rand, nanoid dependencies for plugin system phase 1"
```

---

## Task 2: New Button Struct + Legacy Migration Types

**Files:**
- Modify: `packages/desktop/src-tauri/src/server/state.rs`

- [ ] **Step 1: Write failing tests for the new Button struct and migration**

In `state.rs`, in the `#[cfg(test)]` block, add these tests before the existing ones:

```rust
#[test]
fn button_serde_json_roundtrip() {
    let b = Button {
        name: "Test".into(),
        icon: "test".into(),
        action_uuid: "com.pannacotta.system.open-app".into(),
        context: "abc123xyz456".into(),
        settings: serde_json::json!({"appName": "Calculator"}),
        lan_allowed: None,
    };
    let json = serde_json::to_string(&b).unwrap();
    assert!(json.contains("\"actionUUID\""));
    assert!(json.contains("\"lanAllowed\""));
    let back: Button = serde_json::from_str(&json).unwrap();
    assert_eq!(back.action_uuid, "com.pannacotta.system.open-app");
    assert_eq!(back.context, "abc123xyz456");
    assert!(back.lan_allowed.is_none());
}

#[test]
fn migrate_browser_button() {
    let legacy = LegacyButton {
        name: "Google".into(),
        button_type: "browser".into(),
        icon: "chrome".into(),
        action: "https://google.com".into(),
    };
    let mut seen = std::collections::HashSet::new();
    let b = migrate_button(&legacy, &mut seen);
    assert_eq!(b.action_uuid, "com.pannacotta.browser.open-url");
    assert_eq!(b.settings["url"], "https://google.com");
}

#[test]
fn migrate_system_media_button() {
    let legacy = LegacyButton {
        name: "Vol Up".into(),
        button_type: "system".into(),
        icon: "volume".into(),
        action: "volume-up".into(),
    };
    let mut seen = std::collections::HashSet::new();
    let b = migrate_button(&legacy, &mut seen);
    assert_eq!(b.action_uuid, "com.pannacotta.system.volume-up");
    assert_eq!(b.settings, serde_json::json!({}));
}

#[test]
fn migrate_system_app_button() {
    let legacy = LegacyButton {
        name: "Calculator".into(),
        button_type: "system".into(),
        icon: "calculator".into(),
        action: "Calculator".into(),
    };
    let mut seen = std::collections::HashSet::new();
    let b = migrate_button(&legacy, &mut seen);
    assert_eq!(b.action_uuid, "com.pannacotta.system.open-app");
    assert_eq!(b.settings["appName"], "Calculator");
}

#[test]
fn migrate_generates_unique_contexts() {
    let legacy = LegacyStreamDeckConfig {
        grid: Grid { rows: 2, cols: 3 },
        buttons: vec![
            LegacyButton { name: "A".into(), button_type: "system".into(), icon: "x".into(), action: "Calculator".into() },
            LegacyButton { name: "B".into(), button_type: "browser".into(), icon: "y".into(), action: "https://x.com".into() },
        ],
    };
    let cfg = migrate_config_from_legacy(legacy);
    assert_ne!(cfg.buttons[0].context, cfg.buttons[1].context);
    assert_eq!(cfg.buttons[0].context.len(), 12);
}
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd packages/desktop/src-tauri && cargo test 2>&1 | grep -E "FAILED|error"
```

Expected: compilation errors about unknown types.

- [ ] **Step 3: Add LegacyButton, LegacyStreamDeckConfig types at top of state.rs**

After the existing imports block but before `pub struct Button`, add:

```rust
#[derive(Debug, Deserialize)]
pub struct LegacyButton {
    pub name: String,
    #[serde(rename = "type")]
    pub button_type: String,
    pub icon: String,
    pub action: String,
}

#[derive(Debug, Deserialize)]
pub struct LegacyStreamDeckConfig {
    pub grid: Grid,
    #[serde(default)]
    pub buttons: Vec<LegacyButton>,
}

const SYSTEM_MEDIA_ACTIONS: &[&str] = &[
    "volume-up", "volume-down", "volume-mute",
    "brightness-up", "brightness-down",
    "sleep", "lock",
];

pub fn migrate_button(
    legacy: &LegacyButton,
    existing_contexts: &mut std::collections::HashSet<String>,
) -> Button {
    let (action_uuid, settings) = match legacy.button_type.as_str() {
        "browser" => (
            "com.pannacotta.browser.open-url".to_string(),
            serde_json::json!({"url": legacy.action}),
        ),
        "system" if SYSTEM_MEDIA_ACTIONS.contains(&legacy.action.as_str()) => (
            format!("com.pannacotta.system.{}", legacy.action),
            serde_json::json!({}),
        ),
        "system" => (
            "com.pannacotta.system.open-app".to_string(),
            serde_json::json!({"appName": legacy.action}),
        ),
        other => (
            format!("com.pannacotta.unknown.{}", other),
            serde_json::json!({"action": legacy.action}),
        ),
    };
    Button {
        name: legacy.name.clone(),
        icon: legacy.icon.clone(),
        action_uuid,
        context: generate_unique_context(existing_contexts),
        settings,
        lan_allowed: None,
    }
}

pub fn migrate_config_from_legacy(legacy: LegacyStreamDeckConfig) -> StreamDeckConfig {
    let mut seen = std::collections::HashSet::new();
    StreamDeckConfig {
        grid: legacy.grid,
        buttons: legacy.buttons.iter().map(|b| migrate_button(b, &mut seen)).collect(),
    }
}

fn generate_unique_context(existing: &mut std::collections::HashSet<String>) -> String {
    loop {
        let id = nanoid::nanoid!(12);
        if existing.insert(id.clone()) {
            return id;
        }
    }
}
```

- [ ] **Step 4: Replace the Button struct definition**

Replace the existing:
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Button {
    pub name: String,
    #[serde(rename = "type")]
    pub button_type: String,
    pub icon: String,
    pub action: String,
}
```

With:
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Button {
    pub name: String,
    pub icon: String,
    #[serde(rename = "actionUUID")]
    pub action_uuid: String,
    pub context: String,
    #[serde(default)]
    pub settings: serde_json::Value,
    #[serde(default, rename = "lanAllowed")]
    pub lan_allowed: Option<bool>,
}
```

- [ ] **Step 5: Update `default_config()` to use new Button format**

Replace the `default_config()` function:

```rust
pub fn default_config() -> StreamDeckConfig {
    StreamDeckConfig {
        grid: Grid { rows: 2, cols: 3 },
        buttons: vec![
            Button {
                name: "Calculator".into(),
                icon: "calculator".into(),
                action_uuid: "com.pannacotta.system.open-app".into(),
                context: "aB3dE5fG7hIj".into(),
                settings: serde_json::json!({"appName": "Calculator"}),
                lan_allowed: None,
            },
            Button {
                name: "Google".into(),
                icon: "chrome".into(),
                action_uuid: "com.pannacotta.browser.open-url".into(),
                context: "kL9mN1oP2qRs".into(),
                settings: serde_json::json!({"url": "https://google.com"}),
                lan_allowed: None,
            },
        ],
    }
}
```

- [ ] **Step 6: Fix the existing `default_config_has_two_buttons` test**

In the test block, the `default_config_has_two_buttons` test still passes (it only checks button count). But `save_and_read_config_roundtrip` will now fail because `save_stream_deck_config` still writes TOML. Skip that test for now by noting it will be fixed in Task 3. Run the tests:

```bash
cd packages/desktop/src-tauri && cargo test 2>&1 | grep -E "FAILED|ok|error"
```

Expected: the 5 new tests pass; existing tests either pass or fail only in `save_and_read_config_roundtrip` (which uses TOML write/read). If `save_and_read_config_roundtrip` fails, that is expected and will be fixed in Task 3.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src-tauri/src/server/state.rs
git commit -m "feat: add new Button struct with actionUUID/context/settings/lanAllowed + legacy migration types"
```

---

## Task 3: JSON Profile Operations

**Files:**
- Modify: `packages/desktop/src-tauri/src/server/state.rs`

- [ ] **Step 1: Write failing tests for JSON profile ops**

Add to the `#[cfg(test)]` block:

```rust
#[tokio::test]
async fn profile_json_path_returns_json_ext() {
    let (state, _dir) = temp_state();
    let p = profile_json_path(&state, "Work");
    assert!(p.to_str().unwrap().ends_with("Work.json"));
}

#[tokio::test]
async fn migrate_toml_profile_creates_json_and_backs_up_toml() {
    let (state, _dir) = temp_state();
    tokio::fs::create_dir_all(state.profiles_dir()).await.unwrap();
    let toml_content = r#"
[grid]
rows = 2
cols = 3
[[buttons]]
name = "Calculator"
type = "system"
icon = "calculator"
action = "Calculator"
"#;
    tokio::fs::write(profile_toml_path(&state, "Default"), toml_content).await.unwrap();
    migrate_toml_profile_to_json(&state, "Default").await.unwrap();
    assert!(profile_json_path(&state, "Default").exists());
    assert!(!profile_toml_path(&state, "Default").exists());
    assert!(state.profiles_dir().join("Default.toml.bak").exists());
}

#[tokio::test]
async fn migrate_toml_profile_idempotent() {
    let (state, _dir) = temp_state();
    tokio::fs::create_dir_all(state.profiles_dir()).await.unwrap();
    let toml_content = r#"[grid]
rows = 2
cols = 3
[[buttons]]
name = "A"
type = "system"
icon = "x"
action = "Calculator"
"#;
    tokio::fs::write(profile_toml_path(&state, "Default"), toml_content).await.unwrap();
    migrate_toml_profile_to_json(&state, "Default").await.unwrap();
    migrate_toml_profile_to_json(&state, "Default").await.unwrap();
    assert!(profile_json_path(&state, "Default").exists());
}

#[tokio::test]
async fn save_writes_json_not_toml() {
    let (state, _dir) = temp_state();
    migrate_old_config(&state).await.unwrap();
    let cfg = default_config();
    save_stream_deck_config(&state, &cfg).await.unwrap();
    assert!(profile_json_path(&state, "Default").exists());
    let content = tokio::fs::read_to_string(profile_json_path(&state, "Default")).await.unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
    assert!(parsed["buttons"].is_array());
    assert_eq!(parsed["buttons"][0]["actionUUID"], "com.pannacotta.system.open-app");
}

#[tokio::test]
async fn list_profiles_includes_json_profiles() {
    let (state, _dir) = temp_state();
    tokio::fs::create_dir_all(state.profiles_dir()).await.unwrap();
    let cfg = default_config();
    let json = serde_json::to_string_pretty(&cfg).unwrap();
    tokio::fs::write(profile_json_path(&state, "Work"), json).await.unwrap();
    set_active_profile_name(&state, "Default").await.unwrap();
    let cfg2 = default_config();
    let json2 = serde_json::to_string_pretty(&cfg2).unwrap();
    tokio::fs::write(profile_json_path(&state, "Default"), json2).await.unwrap();
    let profiles = list_profiles(&state).await.unwrap();
    assert!(profiles.iter().any(|p| p.name == "Work"));
    assert!(profiles.iter().any(|p| p.name == "Default"));
}

#[tokio::test]
async fn read_json_profile_returns_new_format() {
    let (state, _dir) = temp_state();
    tokio::fs::create_dir_all(state.profiles_dir()).await.unwrap();
    let cfg = default_config();
    let json = serde_json::to_string_pretty(&cfg).unwrap();
    tokio::fs::write(profile_json_path(&state, "Default"), json).await.unwrap();
    set_active_profile_name(&state, "Default").await.unwrap();
    let loaded = use_stream_deck_config(&state).await.unwrap();
    assert_eq!(loaded.buttons[0].action_uuid, "com.pannacotta.system.open-app");
    assert_eq!(loaded.buttons[0].context, "aB3dE5fG7hIj");
}

#[tokio::test]
async fn read_toml_profile_auto_migrates() {
    let (state, _dir) = temp_state();
    tokio::fs::create_dir_all(state.profiles_dir()).await.unwrap();
    let toml_content = r#"[grid]
rows = 2
cols = 3
[[buttons]]
name = "Safari"
type = "browser"
icon = "safari"
action = "https://apple.com"
"#;
    tokio::fs::write(profile_toml_path(&state, "Default"), toml_content).await.unwrap();
    set_active_profile_name(&state, "Default").await.unwrap();
    let cfg = read_profile(&state, "Default").await;
    assert_eq!(cfg.buttons[0].action_uuid, "com.pannacotta.browser.open-url");
    assert_eq!(cfg.buttons[0].settings["url"], "https://apple.com");
}
```

- [ ] **Step 2: Run to confirm they fail**

```bash
cd packages/desktop/src-tauri && cargo test 2>&1 | grep -E "error\[|FAILED"
```

Expected: compilation errors about `profile_json_path`, `profile_toml_path`, `migrate_toml_profile_to_json`.

- [ ] **Step 3: Add path helpers and write_json_atomic**

Replace the existing `profile_path` function:

```rust
pub fn profile_json_path(state: &AppState, name: &str) -> PathBuf {
    state.profiles_dir().join(format!("{}.json", safe_profile_name(name)))
}

pub fn profile_toml_path(state: &AppState, name: &str) -> PathBuf {
    state.profiles_dir().join(format!("{}.toml", safe_profile_name(name)))
}

async fn write_json_atomic(path: &PathBuf, value: &impl serde::Serialize) -> Result<(), String> {
    let json = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    let tmp = PathBuf::from(format!("{}.tmp", path.display()));
    tokio::fs::write(&tmp, json).await.map_err(|e| e.to_string())?;
    tokio::fs::rename(&tmp, path).await.map_err(|e| e.to_string())
}
```

- [ ] **Step 4: Add `migrate_toml_profile_to_json` function**

Add after `write_json_atomic`:

```rust
pub async fn migrate_toml_profile_to_json(state: &AppState, name: &str) -> Result<(), String> {
    let safe = safe_profile_name(name);
    let toml_path = profile_toml_path(state, &safe);
    let json_path = profile_json_path(state, &safe);
    if json_path.exists() {
        return Ok(());
    }
    let raw = tokio::fs::read_to_string(&toml_path).await.map_err(|e| e.to_string())?;
    let legacy: LegacyStreamDeckConfig = toml::from_str(&raw).map_err(|e| e.to_string())?;
    let config = migrate_config_from_legacy(legacy);
    write_json_atomic(&json_path, &config).await?;
    let bak = state.profiles_dir().join(format!("{}.toml.bak", safe));
    let _ = tokio::fs::rename(&toml_path, &bak).await;
    Ok(())
}
```

- [ ] **Step 5: Update `migrate_old_config`**

Replace the existing `migrate_old_config`:

```rust
pub async fn migrate_old_config(state: &AppState) -> std::io::Result<()> {
    tokio::fs::create_dir_all(state.profiles_dir()).await?;
    let default_json = profile_json_path(state, "Default");
    let default_toml = profile_toml_path(state, "Default");
    if !default_json.exists() && !default_toml.exists() {
        let config = if let Ok(raw) = tokio::fs::read_to_string(state.legacy_config_file()).await {
            toml::from_str::<LegacyStreamDeckConfig>(&raw)
                .map(|l| migrate_config_from_legacy(l))
                .unwrap_or_else(|_| default_config())
        } else {
            default_config()
        };
        write_json_atomic(&default_json, &config)
            .await
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        set_active_profile_name(state, "Default").await?;
    } else if default_toml.exists() && !default_json.exists() {
        migrate_toml_profile_to_json(state, "Default")
            .await
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    }
    Ok(())
}
```

- [ ] **Step 6: Update `read_profile`**

Replace the existing `read_profile`:

```rust
pub async fn read_profile(state: &AppState, name: &str) -> StreamDeckConfig {
    let safe = safe_profile_name(name);
    let json_path = profile_json_path(state, &safe);
    let toml_path = profile_toml_path(state, &safe);
    if json_path.exists() {
        if let Ok(raw) = tokio::fs::read_to_string(&json_path).await {
            if let Ok(cfg) = serde_json::from_str::<StreamDeckConfig>(&raw) {
                return cfg;
            }
        }
    }
    if toml_path.exists() {
        if let Ok(raw) = tokio::fs::read_to_string(&toml_path).await {
            if let Ok(legacy) = toml::from_str::<LegacyStreamDeckConfig>(&raw) {
                return migrate_config_from_legacy(legacy);
            }
        }
    }
    default_config()
}
```

- [ ] **Step 7: Update `save_stream_deck_config` to write JSON**

Replace:

```rust
pub async fn save_stream_deck_config(
    state: &AppState,
    config: &StreamDeckConfig,
) -> Result<(), String> {
    migrate_old_config(state).await.map_err(|e| e.to_string())?;
    let active = get_active_profile_name(state).await;
    tokio::fs::create_dir_all(state.profiles_dir())
        .await
        .map_err(|e| e.to_string())?;
    write_json_atomic(&profile_json_path(state, &active), config).await
}
```

- [ ] **Step 8: Update `create_profile` to write JSON**

Replace:
```rust
pub async fn create_profile(
    state: &AppState,
    name: &str,
    config: Option<&StreamDeckConfig>,
) -> Result<(), String> {
    migrate_old_config(state).await.map_err(|e| e.to_string())?;
    let safe = safe_profile_name(name);
    let json_path = profile_json_path(state, &safe);
    if json_path.exists() {
        return Err(format!("Profile \"{}\" already exists", safe));
    }
    tokio::fs::create_dir_all(state.profiles_dir())
        .await
        .map_err(|e| e.to_string())?;
    write_json_atomic(&json_path, config.unwrap_or(&default_config())).await
}
```

- [ ] **Step 9: Update `activate_profile` to check JSON or TOML**

Replace:
```rust
pub async fn activate_profile(state: &AppState, name: &str) -> Result<(), String> {
    let safe = safe_profile_name(name);
    let json_path = profile_json_path(state, &safe);
    let toml_path = profile_toml_path(state, &safe);
    if !json_path.exists() && !toml_path.exists() {
        return Err(format!("Profile \"{}\" not found", safe));
    }
    set_active_profile_name(state, &safe)
        .await
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 10: Update `delete_profile` to remove JSON + bak files**

Replace:
```rust
pub async fn delete_profile(state: &AppState, name: &str) -> Result<(), String> {
    let profiles = list_profiles(state).await.map_err(|e| e.to_string())?;
    if profiles.len() <= 1 {
        return Err("Cannot delete the last profile".to_string());
    }
    let safe = safe_profile_name(name);
    let json_path = profile_json_path(state, &safe);
    let toml_bak = state.profiles_dir().join(format!("{}.toml.bak", safe));
    let json_tmp = state.profiles_dir().join(format!("{}.json.tmp", safe));
    if json_path.exists() {
        tokio::fs::remove_file(&json_path).await.map_err(|e| e.to_string())?;
    }
    let _ = tokio::fs::remove_file(&toml_bak).await;
    let _ = tokio::fs::remove_file(&json_tmp).await;
    let active = get_active_profile_name(state).await;
    if active == safe {
        if let Some(p) = profiles.iter().find(|p| p.name != safe) {
            let _ = set_active_profile_name(state, &p.name).await;
        }
    }
    Ok(())
}
```

- [ ] **Step 11: Update `rename_profile` to handle JSON**

Replace:
```rust
pub async fn rename_profile(state: &AppState, old: &str, new: &str) -> Result<(), String> {
    let old_safe = safe_profile_name(old);
    let new_safe = safe_profile_name(new);
    if old_safe == new_safe {
        return Ok(());
    }
    let old_json = profile_json_path(state, &old_safe);
    let old_toml = profile_toml_path(state, &old_safe);
    let new_json = profile_json_path(state, &new_safe);
    tokio::fs::create_dir_all(state.profiles_dir()).await.map_err(|e| e.to_string())?;
    if old_json.exists() {
        let content = tokio::fs::read_to_string(&old_json).await.map_err(|e| e.to_string())?;
        tokio::fs::write(&new_json, content).await.map_err(|e| e.to_string())?;
        tokio::fs::remove_file(&old_json).await.map_err(|e| e.to_string())?;
    } else if old_toml.exists() {
        let cfg = read_profile(state, &old_safe).await;
        write_json_atomic(&new_json, &cfg).await?;
        tokio::fs::remove_file(&old_toml).await.map_err(|e| e.to_string())?;
    } else {
        return Err(format!("Profile \"{}\" not found", old_safe));
    }
    let active = get_active_profile_name(state).await;
    if active == old_safe {
        let _ = set_active_profile_name(state, &new_safe).await;
    }
    Ok(())
}
```

- [ ] **Step 12: Update `list_profiles` to list JSON (and TOML without JSON counterpart)**

Replace:
```rust
pub async fn list_profiles(state: &AppState) -> std::io::Result<Vec<Profile>> {
    migrate_old_config(state).await?;
    let active = get_active_profile_name(state).await;
    let mut names: std::collections::HashSet<String> = std::collections::HashSet::new();
    if let Ok(mut entries) = tokio::fs::read_dir(state.profiles_dir()).await {
        while let Some(entry) = entries.next_entry().await? {
            let fname = entry.file_name().to_string_lossy().to_string();
            if fname.ends_with(".json") && !fname.ends_with(".tmp") {
                names.insert(fname[..fname.len() - 5].to_string());
            } else if fname.ends_with(".toml") && !fname.ends_with(".bak") {
                let n = fname[..fname.len() - 5].to_string();
                if !profile_json_path(state, &n).exists() {
                    names.insert(n);
                }
            }
        }
    }
    let mut profiles: Vec<Profile> = names
        .into_iter()
        .map(|name| Profile { is_active: name == active, name })
        .collect();
    if profiles.is_empty() {
        profiles.push(Profile { name: "Default".to_string(), is_active: true });
    }
    profiles.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(profiles)
}
```

- [ ] **Step 13: Update `temp_state` in tests and fix `profile_path` usage**

In the test module, update `temp_state` (no change needed — AppState struct is same so far). Update any test that calls `profile_path` to use `profile_json_path` or `profile_toml_path`. Search and update:

```bash
grep -n "profile_path" packages/desktop/src-tauri/src/server/state.rs
```

Replace any remaining `profile_path(` calls in tests with `profile_json_path(` or `profile_toml_path(` as appropriate. Specifically, `migrate_creates_default_profile` test checks `Default.toml` — update it to check `Default.json`:

In test `migrate_creates_default_profile`, change:
```rust
assert!(state.profiles_dir().join("Default.toml").exists());
```
to:
```rust
assert!(profile_json_path(&state, "Default").exists());
```

In test `delete_profile_removes_file`, change:
```rust
assert!(!profile_path(&state, "Work").exists());
```
to:
```rust
assert!(!profile_json_path(&state, "Work").exists());
```

In test `rename_profile_renames_file`:
```rust
assert!(profile_json_path(&state, "Personal").exists());
assert!(!profile_json_path(&state, "Work").exists());
```

Also remove the old `profile_path` function (it has been replaced by `profile_json_path` + `profile_toml_path`).

- [ ] **Step 14: Run all tests**

```bash
cd packages/desktop/src-tauri && cargo test 2>&1
```

Expected: all 14+ tests pass with no failures.

- [ ] **Step 15: Commit**

```bash
git add packages/desktop/src-tauri/src/server/state.rs
git commit -m "feat: JSON profile ops — migrate TOML→JSON, extension-aware paths, atomic writes"
```

---

## Task 4: AppState CSRF Token + get_csrf_token Command

**Files:**
- Modify: `packages/desktop/src-tauri/src/server/state.rs`
- Modify: `packages/desktop/src-tauri/src/commands/config.rs`

- [ ] **Step 1: Write failing test for CSRF token**

In the state.rs test block:

```rust
#[test]
fn app_state_has_csrf_token() {
    let state = AppState::new();
    assert_eq!(state.csrf_token.len(), 64); // 32 bytes = 64 hex chars
    assert!(state.csrf_token.chars().all(|c| c.is_ascii_hexdigit()));
}

#[test]
fn csrf_tokens_are_unique() {
    let a = AppState::new();
    let b = AppState::new();
    assert_ne!(a.csrf_token, b.csrf_token);
}
```

- [ ] **Step 2: Run to confirm they fail**

```bash
cd packages/desktop/src-tauri && cargo test app_state_has_csrf_token 2>&1 | grep -E "error|FAILED"
```

Expected: compilation error — no `csrf_token` field.

- [ ] **Step 3: Add `csrf_token` to AppState and update `new()`**

In state.rs, add `use rand::Rng;` to the imports (at the top of the file, after `use serde::{Deserialize, Serialize};`).

Update `AppState`:
```rust
pub struct AppState {
    pub config_dir: PathBuf,
    pub port: Mutex<Option<u16>>,
    pub csrf_token: String,
}
```

Update `AppState::new()`:
```rust
impl AppState {
    pub fn new() -> Self {
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_else(|_| ".".to_string());
        let bytes: [u8; 32] = rand::thread_rng().gen();
        let csrf_token: String = bytes.iter().map(|b| format!("{:02x}", b)).collect();
        Self {
            config_dir: PathBuf::from(home).join(".panna-cotta"),
            port: Mutex::new(None),
            csrf_token,
        }
    }
    // ... rest unchanged
}
```

- [ ] **Step 4: Update `temp_state` in tests**

In the test `temp_state` helper, add `csrf_token`:
```rust
fn temp_state() -> (AppState, TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState {
        config_dir: dir.path().to_path_buf(),
        port: Mutex::new(None),
        csrf_token: "test_token_64chars_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into(),
    };
    (state, dir)
}
```

- [ ] **Step 5: Add `get_csrf_token` Tauri command**

In `commands/config.rs`, add at the end:

```rust
#[tauri::command]
pub fn get_csrf_token(state: State<'_, Arc<AppState>>) -> String {
    state.csrf_token.clone()
}
```

- [ ] **Step 6: Register command in app.rs**

In `app.rs`, find the `invoke_handler!` macro call and add `crate::commands::config::get_csrf_token` to the list.

- [ ] **Step 7: Run tests**

```bash
cd packages/desktop/src-tauri && cargo test 2>&1 | grep -E "FAILED|ok$"
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/desktop/src-tauri/src/server/state.rs \
        packages/desktop/src-tauri/src/commands/config.rs \
        packages/desktop/src-tauri/src/app.rs
git commit -m "feat: add CSRF token to AppState and get_csrf_token Tauri command"
```

---

## Task 5: ConnectInfo in Server Startup

**Files:**
- Modify: `packages/desktop/src-tauri/src/server/mod.rs`

- [ ] **Step 1: Update `start()` to use `into_make_service_with_connect_info`**

In `server/mod.rs`, add `use std::net::SocketAddr;` to imports.

Replace the `start()` function body:
```rust
pub async fn start(state: Arc<AppState>) -> Result<u16, String> {
    let port = resolve_port().await?;
    let router = routes::create_router(state.clone());
    let listener = TcpListener::bind(format!("0.0.0.0:{port}"))
        .await
        .map_err(|e| e.to_string())?;

    *state.port.lock().map_err(|e| e.to_string())? = Some(port);

    tauri::async_runtime::spawn(async move {
        axum::serve(
            listener,
            router.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .expect("axum server failed");
    });

    Ok(port)
}
```

- [ ] **Step 2: Verify**

```bash
cd packages/desktop/src-tauri && cargo check
```

Expected: no errors.

- [ ] **Step 3: Run tests**

```bash
cd packages/desktop/src-tauri && cargo test 2>&1 | grep -E "FAILED|ok$"
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src-tauri/src/server/mod.rs
git commit -m "feat: use into_make_service_with_connect_info for ConnectInfo extraction"
```

---

## Task 6: Localhost + CSRF Middleware

**Files:**
- Modify: `packages/desktop/src-tauri/src/server/routes.rs`

- [ ] **Step 1: Write failing tests**

Add a `#[cfg(test)]` block at the bottom of `routes.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;

    fn make_state(csrf: &str) -> Arc<AppState> {
        use std::sync::Mutex;
        use std::path::PathBuf;
        Arc::new(AppState {
            config_dir: PathBuf::from("/tmp/test-panna"),
            port: Mutex::new(None),
            csrf_token: csrf.to_string(),
        })
    }

    fn lan_addr() -> std::net::SocketAddr {
        "192.168.1.100:54321".parse().unwrap()
    }

    fn local_addr() -> std::net::SocketAddr {
        "127.0.0.1:54321".parse().unwrap()
    }

    #[test]
    fn is_localhost_addr_loopback() {
        assert!(is_localhost_addr(&"127.0.0.1:0".parse().unwrap()));
        assert!(is_localhost_addr(&"[::1]:0".parse().unwrap()));
        assert!(!is_localhost_addr(&"192.168.1.1:0".parse().unwrap()));
        assert!(!is_localhost_addr(&"10.0.0.1:0".parse().unwrap()));
    }

    #[tokio::test]
    async fn admin_route_from_lan_returns_403() {
        let csrf = "aabbcc";
        let state = make_state(csrf);
        let app = create_router(state.clone());
        let req = Request::builder()
            .method("PUT")
            .uri("/api/config")
            .header("Content-Type", "application/json")
            .extension(axum::extract::ConnectInfo(lan_addr()))
            .header("X-Panna-CSRF", csrf)
            .body(Body::from(r#"{"grid":{"rows":2,"cols":3},"buttons":[]}"#))
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), 403);
    }

    #[tokio::test]
    async fn admin_route_localhost_missing_csrf_returns_403() {
        let state = make_state("secret123");
        let app = create_router(state.clone());
        let req = Request::builder()
            .method("PUT")
            .uri("/api/config")
            .header("Content-Type", "application/json")
            .extension(axum::extract::ConnectInfo(local_addr()))
            .body(Body::from(r#"{"grid":{"rows":2,"cols":3},"buttons":[]}"#))
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), 403);
    }

    #[tokio::test]
    async fn admin_route_localhost_wrong_csrf_returns_403() {
        let state = make_state("correct_token");
        let app = create_router(state.clone());
        let req = Request::builder()
            .method("PUT")
            .uri("/api/config")
            .header("Content-Type", "application/json")
            .extension(axum::extract::ConnectInfo(local_addr()))
            .header("X-Panna-CSRF", "wrong_token")
            .body(Body::from(r#"{"grid":{"rows":2,"cols":3},"buttons":[]}"#))
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), 403);
    }
}
```

- [ ] **Step 2: Run to confirm they fail**

```bash
cd packages/desktop/src-tauri && cargo test -p panna-cotta-lib -- routes 2>&1 | grep -E "error|FAILED"
```

Expected: compilation errors.

- [ ] **Step 3: Add imports and helper to routes.rs**

Add to the imports at the top of `routes.rs`:

```rust
use axum::{
    body::Body,
    extract::{ConnectInfo, Path, State},
    http::{header, HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Json, Redirect, Response},
    routing::{delete, get, patch, post, put},
    Router,
};
use std::net::SocketAddr;
use std::sync::Arc;
```

(Replace the existing `use axum::{...}` block with this.)

Add after the imports:

```rust
pub fn is_localhost_addr(addr: &SocketAddr) -> bool {
    let ip = addr.ip();
    ip == std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)
        || ip == std::net::IpAddr::V6(std::net::Ipv6Addr::LOCALHOST)
}

async fn require_admin(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    if !is_localhost_addr(&addr) {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({"error": "localhost only"}))).into_response();
    }
    let token_ok = headers
        .get("X-Panna-CSRF")
        .and_then(|v| v.to_str().ok())
        .map(|t| t == state.csrf_token)
        .unwrap_or(false);
    if !token_ok {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({"error": "invalid CSRF token"}))).into_response();
    }
    next.run(request).await
}
```

- [ ] **Step 4: Split `create_router` into public + admin subrouters**

Replace `create_router`:

```rust
pub fn create_router(state: Arc<AppState>) -> Router {
    let admin = Router::new()
        .route("/api/config", put(put_config))
        .route("/api/profiles", post(create_profile_handler))
        .route("/api/profiles/:name/activate", post(activate_profile_handler))
        .route("/api/profiles/:name", patch(rename_profile_handler).delete(delete_profile_handler))
        .route("/api/open-app", post(open_app_handler))
        .route("/api/open-url", post(open_url_handler))
        .route("/api/open-config-folder", post(open_config_folder_handler))
        .layer(middleware::from_fn_with_state(state.clone(), require_admin));

    Router::new()
        .route("/", get(qr_page))
        .route("/apps", get(|| async { Redirect::permanent("/apps/") }))
        .route("/apps/", get(serve_apps_index))
        .route("/apps/*path", get(serve_apps_file))
        .route("/api/health", get(|| async { "OK" }))
        .route("/api/config", get(get_config))
        .route("/api/config/default", get(get_default_config_handler))
        .route("/api/profiles", get(list_profiles_handler))
        .route("/api/execute", post(execute_handler))
        .merge(admin)
        .with_state(state)
}
```

- [ ] **Step 5: Run tests**

```bash
cd packages/desktop/src-tauri && cargo test 2>&1 | grep -E "FAILED|ok$"
```

Expected: all tests including the 3 new middleware tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src-tauri/src/server/routes.rs
git commit -m "feat: add localhost+CSRF admin middleware, split router into public/admin"
```

---

## Task 7: Execute Route Refactor

**Files:**
- Modify: `packages/desktop/src-tauri/src/server/routes.rs`

The execute route needs two paths:
- **LAN (non-localhost):** accept `{ "context": "..." }` only; dispatch built-in actions inline; check `lan_allowed`
- **localhost:** require CSRF; accept both `{ "context": "..." }` and legacy `{ "action": "...", "target": "..." }`

- [ ] **Step 1: Write failing tests**

Add to the routes.rs test block. These tests need a profile on disk. Create a helper:

```rust
async fn state_with_profile(csrf: &str, buttons: Vec<crate::server::state::Button>) -> Arc<AppState> {
    let dir = tempfile::tempdir().unwrap();
    // leak dir so it lives for the test
    let dir_path = dir.into_path();
    let profiles_dir = dir_path.join("profiles");
    tokio::fs::create_dir_all(&profiles_dir).await.unwrap();
    let config = crate::server::state::StreamDeckConfig {
        grid: crate::server::state::Grid { rows: 2, cols: 3 },
        buttons,
    };
    let json = serde_json::to_string_pretty(&config).unwrap();
    tokio::fs::write(profiles_dir.join("Default.json"), json).await.unwrap();
    tokio::fs::write(dir_path.join("active-profile"), "Default").await.unwrap();
    Arc::new(AppState {
        config_dir: dir_path,
        port: std::sync::Mutex::new(None),
        csrf_token: csrf.to_string(),
    })
}

#[tokio::test]
async fn execute_context_from_lan_accepted() {
    let buttons = vec![crate::server::state::Button {
        name: "Vol Up".into(),
        icon: "v".into(),
        action_uuid: "com.pannacotta.system.volume-up".into(),
        context: "ctx001".into(),
        settings: serde_json::json!({}),
        lan_allowed: None,
    }];
    let state = state_with_profile("tok", buttons).await;
    let app = create_router(state.clone());
    let req = Request::builder()
        .method("POST")
        .uri("/api/execute")
        .header("Content-Type", "application/json")
        .extension(axum::extract::ConnectInfo(lan_addr()))
        .body(Body::from(r#"{"context":"ctx001"}"#))
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    // 200 or 500 (system command may fail in test env), but NOT 400 or 403
    assert!(res.status() != 400 && res.status() != 403);
}

#[tokio::test]
async fn execute_legacy_from_lan_rejected() {
    let state = make_state("tok");
    let app = create_router(state.clone());
    let req = Request::builder()
        .method("POST")
        .uri("/api/execute")
        .header("Content-Type", "application/json")
        .extension(axum::extract::ConnectInfo(lan_addr()))
        .body(Body::from(r#"{"action":"open-app","target":"Calculator"}"#))
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), 400);
}

#[tokio::test]
async fn execute_lan_allowed_false_returns_403() {
    let buttons = vec![crate::server::state::Button {
        name: "Secret".into(),
        icon: "x".into(),
        action_uuid: "com.pannacotta.system.open-app".into(),
        context: "secret1".into(),
        settings: serde_json::json!({"appName": "Terminal"}),
        lan_allowed: Some(false),
    }];
    let state = state_with_profile("tok", buttons).await;
    let app = create_router(state.clone());
    let req = Request::builder()
        .method("POST")
        .uri("/api/execute")
        .header("Content-Type", "application/json")
        .extension(axum::extract::ConnectInfo(lan_addr()))
        .body(Body::from(r#"{"context":"secret1"}"#))
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), 403);
}

#[tokio::test]
async fn execute_unknown_context_returns_404() {
    let state = make_state("tok");
    // state_with_profile creates a valid dir; make_state creates /tmp/test-panna which has no profile
    // So context lookup will fail → 404
    let buttons = vec![];
    let state = state_with_profile("tok", buttons).await;
    let app = create_router(state.clone());
    let req = Request::builder()
        .method("POST")
        .uri("/api/execute")
        .header("Content-Type", "application/json")
        .extension(axum::extract::ConnectInfo(lan_addr()))
        .body(Body::from(r#"{"context":"nosuchctx"}"#))
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), 404);
}
```

- [ ] **Step 2: Run to confirm they fail**

```bash
cd packages/desktop/src-tauri && cargo test execute 2>&1 | grep -E "error|FAILED"
```

Expected: compilation errors.

- [ ] **Step 3: Add `dispatch_context` and `run_shell_command` helpers**

Add these functions in `routes.rs` before the handlers section:

```rust
async fn validate_url(url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|_| format!("invalid URL: {url}"))?;
    match parsed.scheme() {
        "https" | "http" => Ok(()),
        s => Err(format!("URL scheme '{s}' not allowed; use https or http")),
    }
}

async fn run_shell_command(cmd: &str) -> Result<(), String> {
    let status = if cfg!(windows) {
        tokio::process::Command::new("cmd").args(["/C", cmd]).status().await
    } else {
        tokio::process::Command::new("sh").args(["-c", cmd]).status().await
    };
    status
        .map_err(|e| e.to_string())
        .and_then(|s| if s.success() { Ok(()) } else { Err(format!("command exited: {s}")) })
}

async fn dispatch_context(button: &crate::server::state::Button) -> Result<(), String> {
    let uuid = button.action_uuid.as_str();
    let s = &button.settings;
    match uuid {
        "com.pannacotta.system.open-app" => {
            let app = s.get("appName").and_then(|v| v.as_str()).ok_or("missing appName")?;
            crate::commands::system::open_app(app.to_string()).await
        }
        "com.pannacotta.browser.open-url" => {
            let url = s.get("url").and_then(|v| v.as_str()).ok_or("missing url")?;
            validate_url(url).await?;
            crate::commands::system::open_url(url.to_string()).await
        }
        "com.pannacotta.system.volume-up" => {
            crate::commands::system::execute_command("volume-up".into(), "".into()).await
        }
        "com.pannacotta.system.volume-down" => {
            crate::commands::system::execute_command("volume-down".into(), "".into()).await
        }
        "com.pannacotta.system.volume-mute" => {
            crate::commands::system::execute_command("volume-mute".into(), "".into()).await
        }
        "com.pannacotta.system.brightness-up" => {
            crate::commands::system::execute_command("brightness-up".into(), "".into()).await
        }
        "com.pannacotta.system.brightness-down" => {
            crate::commands::system::execute_command("brightness-down".into(), "".into()).await
        }
        "com.pannacotta.system.sleep" => {
            crate::commands::system::execute_command("sleep".into(), "".into()).await
        }
        "com.pannacotta.system.lock" => {
            crate::commands::system::execute_command("lock".into(), "".into()).await
        }
        "com.pannacotta.system.run-command" => {
            let cmd = s.get("command").and_then(|v| v.as_str()).ok_or("missing command")?;
            run_shell_command(cmd).await
        }
        _ => Err(format!("unknown actionUUID: {uuid}")),
    }
}
```

- [ ] **Step 4: Replace execute handler**

Remove the existing `ExecuteBody` struct and `execute_handler` and replace with:

```rust
#[derive(serde::Deserialize)]
struct ExecuteBody {
    context: Option<String>,
    action: Option<String>,
    target: Option<String>,
}

async fn execute_handler(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<ExecuteBody>,
) -> impl IntoResponse {
    let is_local = is_localhost_addr(&addr);

    if is_local {
        let csrf_ok = headers
            .get("X-Panna-CSRF")
            .and_then(|v| v.to_str().ok())
            .map(|t| t == state.csrf_token)
            .unwrap_or(false);
        if !csrf_ok {
            return (StatusCode::FORBIDDEN, Json(serde_json::json!({"error": "CSRF required"}))).into_response();
        }
    }

    if let Some(ctx) = body.context {
        // Context-based path (LAN + localhost with CSRF)
        let config = match crate::server::state::use_stream_deck_config(&state).await {
            Ok(c) => c,
            Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e}))).into_response(),
        };
        let button = match config.buttons.iter().find(|b| b.context == ctx) {
            Some(b) => b.clone(),
            None => return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "context not found"}))).into_response(),
        };
        if button.lan_allowed == Some(false) && !is_local {
            return (StatusCode::FORBIDDEN, Json(serde_json::json!({"error": "not allowed from LAN"}))).into_response();
        }
        match dispatch_context(&button).await {
            Ok(_) => Json(serde_json::json!({"success": true})).into_response(),
            Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e}))).into_response(),
        }
    } else if let (Some(action), Some(target)) = (body.action, body.target) {
        // Legacy action+target path: localhost + CSRF only (already checked above)
        if !is_local {
            return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "use {context} from LAN"}))).into_response();
        }
        // Validate against allowed legacy actions
        let config = match crate::server::state::use_stream_deck_config(&state).await {
            Ok(c) => c,
            Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e}))).into_response(),
        };
        let allowed = match action.as_str() {
            "open-app" => config.buttons.iter().any(|b|
                b.action_uuid == "com.pannacotta.system.open-app"
                && b.settings.get("appName").and_then(|v| v.as_str()) == Some(&target)),
            "volume-up" | "volume-down" | "volume-mute" |
            "brightness-up" | "brightness-down" | "sleep" | "lock" => {
                let uuid = format!("com.pannacotta.system.{action}");
                config.buttons.iter().any(|b| b.action_uuid == uuid)
            }
            _ => false,
        };
        if !allowed {
            return (StatusCode::FORBIDDEN, Json(serde_json::json!({"error": "action not in active profile"}))).into_response();
        }
        match crate::commands::system::execute_command(action, target).await {
            Ok(_) => Json(serde_json::json!({"success": true})).into_response(),
            Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e}))).into_response(),
        }
    } else {
        (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "provide {context} or {action,target}"}))).into_response()
    }
}
```

- [ ] **Step 5: Add `tokio` process import**

At the top of `routes.rs`, the `tokio::process::Command` is used in `run_shell_command`. Add import note: `tokio` is already in Cargo.toml with `features = ["full"]`, so no changes needed.

- [ ] **Step 6: Run tests**

```bash
cd packages/desktop/src-tauri && cargo test 2>&1 | grep -E "FAILED|ok$"
```

Expected: all tests pass. The `execute_context_from_lan_accepted` test may get a 500 (system command failed in test env) — that is acceptable; it should NOT be 400 or 403.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src-tauri/src/server/routes.rs
git commit -m "feat: refactor execute route — context-based LAN, legacy localhost+CSRF, lan_allowed enforcement"
```

---

## Task 8: Config GET Settings Redaction

**Files:**
- Modify: `packages/desktop/src-tauri/src/server/routes.rs`

- [ ] **Step 1: Write failing test**

Add to the routes.rs test block:

```rust
#[tokio::test]
async fn get_config_redacts_settings_without_csrf() {
    let buttons = vec![crate::server::state::Button {
        name: "Secret".into(),
        icon: "x".into(),
        action_uuid: "com.pannacotta.system.open-app".into(),
        context: "ctx123".into(),
        settings: serde_json::json!({"appName": "Terminal", "secret": "data"}),
        lan_allowed: None,
    }];
    let state = state_with_profile("mytoken", buttons).await;
    let app = create_router(state.clone());
    let req = Request::builder()
        .method("GET")
        .uri("/api/config")
        .extension(axum::extract::ConnectInfo(lan_addr()))
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), 200);
    let body = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    // settings should be stripped
    let btn = &json["buttons"][0];
    assert!(btn["settings"].is_null() || btn.get("settings").is_none(),
        "settings should be redacted, got: {btn}");
    // context, name, icon, actionUUID should still be present
    assert_eq!(btn["context"], "ctx123");
    assert_eq!(btn["name"], "Secret");
}

#[tokio::test]
async fn get_config_includes_settings_with_csrf() {
    let buttons = vec![crate::server::state::Button {
        name: "Secret".into(),
        icon: "x".into(),
        action_uuid: "com.pannacotta.system.open-app".into(),
        context: "ctx456".into(),
        settings: serde_json::json!({"appName": "Terminal"}),
        lan_allowed: None,
    }];
    let state = state_with_profile("mytoken", buttons).await;
    let app = create_router(state.clone());
    let req = Request::builder()
        .method("GET")
        .uri("/api/config")
        .header("X-Panna-CSRF", "mytoken")
        .extension(axum::extract::ConnectInfo(local_addr()))
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    let body = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let btn = &json["buttons"][0];
    assert_eq!(btn["settings"]["appName"], "Terminal");
}
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd packages/desktop/src-tauri && cargo test get_config 2>&1 | grep -E "FAILED|error"
```

Expected: `get_config_redacts_settings_without_csrf` fails (settings not yet redacted).

- [ ] **Step 3: Update `get_config` handler**

Replace the existing `get_config` function:

```rust
async fn get_config(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let has_csrf = is_localhost_addr(&addr)
        && headers
            .get("X-Panna-CSRF")
            .and_then(|v| v.to_str().ok())
            .map(|t| t == state.csrf_token)
            .unwrap_or(false);

    match use_stream_deck_config(&state).await {
        Ok(mut cfg) => {
            if !has_csrf {
                for button in &mut cfg.buttons {
                    button.settings = serde_json::Value::Null;
                }
            }
            (StatusCode::OK, Json(serde_json::json!(cfg))).into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e}))).into_response(),
    }
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/desktop/src-tauri && cargo test 2>&1 | grep -E "FAILED|ok$"
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src-tauri/src/server/routes.rs
git commit -m "feat: redact button settings in GET /api/config when no CSRF token"
```

---

## Task 9: URL Validation + Gate open-app/open-url

**Files:**
- Modify: `packages/desktop/src-tauri/src/commands/system.rs`
- Modify: `packages/desktop/src-tauri/src/server/routes.rs`

The `open_app` and `open_url` HTTP handlers are already behind the admin middleware (from Task 6). This task adds URL scheme validation to the `open_url` Tauri command and HTTP handler.

- [ ] **Step 1: Write failing tests**

In `routes.rs` test block, add:

```rust
#[tokio::test]
async fn open_url_from_lan_rejected() {
    let state = make_state("tok");
    let app = create_router(state);
    let req = Request::builder()
        .method("POST")
        .uri("/api/open-url")
        .header("Content-Type", "application/json")
        .extension(axum::extract::ConnectInfo(lan_addr()))
        .body(Body::from(r#"{"url":"https://example.com"}"#))
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), 403);
}
```

Add unit tests in `commands/system.rs`:

```rust
#[cfg(test)]
mod tests {
    #[test]
    fn open_url_rejects_file_scheme() {
        // Test validate_url_scheme directly
        assert!(super::validate_url_scheme("file:///etc/passwd").is_err());
        assert!(super::validate_url_scheme("javascript:alert(1)").is_err());
        assert!(super::validate_url_scheme("ftp://example.com").is_err());
    }

    #[test]
    fn open_url_accepts_http_https() {
        assert!(super::validate_url_scheme("https://example.com").is_ok());
        assert!(super::validate_url_scheme("http://localhost:3000").is_ok());
    }
}
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd packages/desktop/src-tauri && cargo test open_url 2>&1 | grep -E "FAILED|error"
```

Expected: compile error about `validate_url_scheme`.

- [ ] **Step 3: Add `validate_url_scheme` to `commands/system.rs`**

Add at the top of `system.rs` after existing imports:
```rust
use url::Url;
```

Add this function before `execute_command`:
```rust
pub fn validate_url_scheme(url: &str) -> Result<(), String> {
    let parsed = Url::parse(url).map_err(|_| format!("invalid URL: {url}"))?;
    match parsed.scheme() {
        "https" | "http" => Ok(()),
        s => Err(format!("URL scheme '{s}' not allowed; only https and http are accepted")),
    }
}
```

Update `open_url`:
```rust
#[tauri::command]
pub async fn open_url(url: String) -> Result<(), String> {
    validate_url_scheme(&url)?;
    Command::new("open")
        .arg(&url)
        .output()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
```

Note: `Command` here is `std::process::Command` which is already imported. On Windows/Linux, `open` won't exist but the URL validation still runs. For cross-platform, use the `open` crate (out of scope here — kept as is from existing code).

- [ ] **Step 4: Update `open_url_handler` in routes.rs to validate URL**

Replace `open_url_handler`:

```rust
async fn open_url_handler(Json(body): Json<UrlBody>) -> impl IntoResponse {
    if let Err(e) = validate_url(&body.url).await {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": e}))).into_response();
    }
    match crate::commands::system::open_url(body.url).await {
        Ok(_) => Json(serde_json::json!({"success": true})).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"success": false, "message": e}))).into_response(),
    }
}
```

- [ ] **Step 5: Run all tests**

```bash
cd packages/desktop/src-tauri && cargo test 2>&1
```

Expected: all tests pass including the new URL validation tests.

- [ ] **Step 6: Run cargo clippy**

```bash
cd packages/desktop/src-tauri && cargo clippy 2>&1 | grep "^error"
```

Expected: no errors (warnings OK).

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src-tauri/src/commands/system.rs \
        packages/desktop/src-tauri/src/server/routes.rs
git commit -m "feat: URL scheme validation for open_url; open-app/open-url gated to localhost+CSRF"
```

---

## Task 10: TypeScript Type Updates

**Files:**
- Modify: `packages/desktop/src/lib/types.ts`
- Modify: `packages/desktop/src/lib/invoke.ts`

- [ ] **Step 1: Update `Button` interface in types.ts**

Replace the `Button` interface:

```typescript
export interface Button {
  name: string
  icon: string
  actionUUID: string
  context: string
  settings: Record<string, unknown>
  lanAllowed?: boolean | null
}
```

- [ ] **Step 2: Add `getCsrfToken` and `checkForUpdates` to invoke.ts**

Add to `invoke.ts`:

```typescript
export const getCsrfToken = () =>
  invoke<string>('get_csrf_token')
```

- [ ] **Step 3: Build to check for TypeScript errors**

```bash
cd packages/desktop && npm run build 2>&1
```

Expected: clean build. If any components reference old `button.type` or `button.action` fields, fix them to use `button.actionUUID` and `button.settings`.

- [ ] **Step 4: Fix any component references to old Button fields**

Run:
```bash
grep -rn "\.type\b\|\.action\b\|button_type\|\"type\"\|\"action\"" \
  packages/desktop/src/ --include="*.ts" --include="*.tsx" --include="*.svelte"
```

For each hit in `.tsx` files that references the old `button.type` or `button.action` field, update to use `button.actionUUID` and `button.settings`.

- [ ] **Step 5: Rebuild**

```bash
cd packages/desktop && npm run build 2>&1
```

Expected: exits 0, no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/lib/types.ts packages/desktop/src/lib/invoke.ts
git commit -m "feat: update Button TypeScript type to match new JSON schema; add getCsrfToken"
```

---

## Task 11: Final Verification

- [ ] **Step 1: Full cargo test**

```bash
cd packages/desktop/src-tauri && cargo test 2>&1
```

Expected: all tests pass.

- [ ] **Step 2: Cargo clippy clean**

```bash
cd packages/desktop/src-tauri && cargo clippy 2>&1 | grep "^error"
```

Expected: no errors.

- [ ] **Step 3: Svelte/React build**

```bash
cd packages/desktop && npm run build 2>&1
```

Expected: clean exit.

- [ ] **Step 4: Smoke test**

Start the dev server:
```bash
cd packages/desktop && npm run tauri dev
```

Verify:
- App launches, tray icon appears
- Admin window opens, shows buttons
- Profile switching works
- Config folder contains `.json` files (not `.toml`)
- DevTools console: no errors

- [ ] **Step 5: Final commit if any fixups needed, then note plan completion**

After all green:
```bash
git log --oneline main..HEAD
```

Expected: 10-12 commits on the branch covering all tasks.
