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
    if s.is_empty() {
        "Default".to_string()
    } else {
        s
    }
}

pub fn profile_path(state: &AppState, name: &str) -> PathBuf {
    state
        .profiles_dir()
        .join(format!("{}.toml", safe_profile_name(name)))
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
                    profiles.push(Profile {
                        is_active: name == active,
                        name,
                    });
                }
            }
        }
        Err(_) => {}
    }

    if profiles.is_empty() {
        profiles.push(Profile {
            name: "Default".to_string(),
            is_active: true,
        });
    }
    profiles.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(profiles)
}

pub async fn create_profile(
    state: &AppState,
    name: &str,
    config: Option<&StreamDeckConfig>,
) -> Result<(), String> {
    migrate_old_config(state)
        .await
        .map_err(|e| e.to_string())?;
    let path = profile_path(state, name);
    if path.exists() {
        return Err(format!(
            "Profile \"{}\" already exists",
            safe_profile_name(name)
        ));
    }
    tokio::fs::create_dir_all(state.profiles_dir())
        .await
        .map_err(|e| e.to_string())?;
    let content =
        toml::to_string(config.unwrap_or(&default_config())).map_err(|e| e.to_string())?;
    tokio::fs::write(path, content)
        .await
        .map_err(|e| e.to_string())
}

pub async fn activate_profile(state: &AppState, name: &str) -> Result<(), String> {
    let path = profile_path(state, name);
    if !path.exists() {
        return Err(format!(
            "Profile \"{}\" not found",
            safe_profile_name(name)
        ));
    }
    set_active_profile_name(state, name)
        .await
        .map_err(|e| e.to_string())
}

pub async fn delete_profile(state: &AppState, name: &str) -> Result<(), String> {
    let profiles = list_profiles(state)
        .await
        .map_err(|e| e.to_string())?;
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
    migrate_old_config(state)
        .await
        .map_err(|e| e.to_string())?;
    let active = get_active_profile_name(state).await;
    Ok(read_profile(state, &active).await)
}

pub async fn save_stream_deck_config(
    state: &AppState,
    config: &StreamDeckConfig,
) -> Result<(), String> {
    migrate_old_config(state)
        .await
        .map_err(|e| e.to_string())?;
    let active = get_active_profile_name(state).await;
    tokio::fs::create_dir_all(state.profiles_dir())
        .await
        .map_err(|e| e.to_string())?;
    let content = toml::to_string(config).map_err(|e| e.to_string())?;
    tokio::fs::write(profile_path(state, &active), content)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
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
        assert!(state.profiles_dir().join("Default.toml").exists());
        let name = get_active_profile_name(&state).await;
        assert_eq!(name, "Default");
    }

    #[tokio::test]
    async fn migrate_is_idempotent() {
        let (state, _dir) = temp_state();
        migrate_old_config(&state).await.unwrap();
        migrate_old_config(&state).await.unwrap();
        assert!(state.profiles_dir().join("Default.toml").exists());
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
}
