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
