use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use rand::{Rng, rngs::OsRng};

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



pub struct AppState {
    pub config_dir: PathBuf,
    pub port: Mutex<Option<u16>>,
    pub csrf_token: String,
    pub plugin_host: Arc<tokio::sync::Mutex<crate::plugin::PluginHost>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
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
    if s.is_empty() {
        "Default".to_string()
    } else {
        s
    }
}

pub fn profile_json_path(state: &AppState, name: &str) -> PathBuf {
    state.profiles_dir().join(format!("{}.json", safe_profile_name(name)))
}

pub fn profile_toml_path(state: &AppState, name: &str) -> PathBuf {
    state.profiles_dir().join(format!("{}.toml", safe_profile_name(name)))
}

async fn write_json_atomic(path: &PathBuf, value: &impl serde::Serialize) -> Result<(), String> {
    let json = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    tokio::fs::write(&tmp, json).await.map_err(|e| e.to_string())?;
    tokio::fs::rename(&tmp, path).await.map_err(|e| e.to_string())
}

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

pub async fn get_active_profile_name(state: &AppState) -> String {
    tokio::fs::read_to_string(state.active_profile_file())
        .await
        .map(|s| s.trim().to_string())
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Default".to_string())
}

pub async fn set_active_profile_name(state: &AppState, name: &str) -> std::io::Result<()> {
    tokio::fs::write(state.active_profile_file(), safe_profile_name(name)).await
}

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

pub async fn migrate_old_config(state: &AppState) -> std::io::Result<()> {
    tokio::fs::create_dir_all(state.profiles_dir()).await?;
    let default_json = profile_json_path(state, "Default");
    let default_toml = profile_toml_path(state, "Default");
    if !default_json.exists() && !default_toml.exists() {
        let config = if let Ok(raw) = tokio::fs::read_to_string(state.legacy_config_file()).await {
            toml::from_str::<LegacyStreamDeckConfig>(&raw)
                .map(migrate_config_from_legacy)
                .unwrap_or_else(|_| default_config())
        } else {
            default_config()
        };
        write_json_atomic(&default_json, &config)
            .await
            .map_err(std::io::Error::other)?;
        set_active_profile_name(state, "Default").await?;
    } else if default_toml.exists() && !default_json.exists() {
        migrate_toml_profile_to_json(state, "Default")
            .await
            .map_err(std::io::Error::other)?;
    }
    Ok(())
}

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
    let result = write_json_atomic(&json_path, config.unwrap_or(&default_config())).await;
    if result.is_ok() {
        tracing::info!(profile = %safe, "profile created");
    }
    result
}

pub async fn activate_profile(state: &AppState, name: &str) -> Result<(), String> {
    let safe = safe_profile_name(name);
    let json_path = profile_json_path(state, &safe);
    let toml_path = profile_toml_path(state, &safe);
    if !json_path.exists() && !toml_path.exists() {
        return Err(format!("Profile \"{}\" not found", safe));
    }
    set_active_profile_name(state, &safe).await.map_err(|e| e.to_string())?;
    let new_config = read_profile(state, &safe).await;
    // Fire lifecycle events through PluginHost (host internally acquires profile_state)
    let mut host = state.plugin_host.lock().await;
    host.fire_profile_lifecycle(new_config).await;
    drop(host);
    tracing::info!(profile = %safe, "profile activated");
    Ok(())
}

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
    let toml_path = profile_toml_path(state, &safe);
    if toml_path.exists() {
        tokio::fs::remove_file(&toml_path).await.map_err(|e| e.to_string())?;
    }
    let _ = tokio::fs::remove_file(&toml_bak).await;
    let _ = tokio::fs::remove_file(&json_tmp).await;
    let active = get_active_profile_name(state).await;
    if active == safe {
        if let Some(p) = profiles.iter().find(|p| p.name != safe) {
            let _ = set_active_profile_name(state, &p.name).await;
        }
    }
    tracing::info!(profile = %safe, "profile deleted");
    Ok(())
}

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
        tokio::fs::rename(&old_json, &new_json).await.map_err(|e| e.to_string())?;
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
    tracing::info!(from = %old_safe, to = %new_safe, "profile renamed");
    Ok(())
}

pub async fn use_stream_deck_config(state: &AppState) -> Result<StreamDeckConfig, String> {
    let host = state.plugin_host.lock().await;
    let config = host.profile_state.lock().await.clone();
    Ok(config)
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
    // Write to disk outside both locks
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

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
        assert!(profile_json_path(&state, "Default").exists());
        let name = get_active_profile_name(&state).await;
        assert_eq!(name, "Default");
    }

    #[tokio::test]
    async fn migrate_is_idempotent() {
        let (state, _dir) = temp_state();
        migrate_old_config(&state).await.unwrap();
        migrate_old_config(&state).await.unwrap();
        assert!(profile_json_path(&state, "Default").exists());
    }

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
        assert!(!profile_json_path(&state, "Work").exists());
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
        assert!(profile_json_path(&state, "Personal").exists());
        assert!(!profile_json_path(&state, "Work").exists());
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
}
