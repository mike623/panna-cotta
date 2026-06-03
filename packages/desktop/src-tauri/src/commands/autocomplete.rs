use std::sync::Arc;
use tauri::State;

use crate::autocomplete::state::AutocompleteConfig;
use crate::server::state::AppState;

fn config_path(state: &AppState) -> std::path::PathBuf {
    state.config_dir.join("autocomplete.json")
}

async fn load_config(state: &AppState) -> AutocompleteConfig {
    let path = config_path(state);
    tokio::fs::read_to_string(&path)
        .await
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

async fn save_config(state: &AppState, config: &AutocompleteConfig) -> std::io::Result<()> {
    let path = config_path(state);
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let json = serde_json::to_string_pretty(config)
        .map_err(std::io::Error::other)?;
    tokio::fs::write(path, json).await
}

/// Public helper for startup config loading (not a Tauri command).
pub async fn load_config_raw(state: &AppState) -> AutocompleteConfig {
    load_config(state).await
}

#[tauri::command]
pub async fn get_autocomplete_config(
    state: State<'_, Arc<AppState>>,
) -> Result<AutocompleteConfig, String> {
    Ok(load_config(&state).await)
}

#[tauri::command]
pub async fn set_autocomplete_enabled(
    enabled: bool,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let mut config = load_config(&state).await;
    config.enabled = enabled;
    *state.autocomplete.config.lock().unwrap() = config.clone();
    save_config(&state, &config).await.map_err(|e| e.to_string())?;
    if enabled {
        #[cfg(target_os = "macos")]
        crate::autocomplete::tap::start_monitor(state.autocomplete.clone());
    }
    Ok(())
}

#[tauri::command]
pub async fn set_autocomplete_suggestion_count(
    count: usize,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let clamped = if count <= 3 { 3 } else { 5 };
    let mut config = load_config(&state).await;
    config.suggestion_count = clamped;
    *state.autocomplete.config.lock().unwrap() = config.clone();
    save_config(&state, &config).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_autocomplete_fallback_phrases(
    phrases: Vec<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let mut config = load_config(&state).await;
    config.fallback_phrases = phrases;
    *state.autocomplete.config.lock().unwrap() = config.clone();
    save_config(&state, &config).await.map_err(|e| e.to_string())?;
    state.autocomplete.reset_to_fallback();
    Ok(())
}

#[tauri::command]
pub fn get_accessibility_status() -> bool {
    #[cfg(target_os = "macos")]
    {
        // Check Accessibility permission by attempting a no-op keystroke
        let out = std::process::Command::new("osascript")
            .args(["-e", "tell application \"System Events\" to keystroke \"\""])
            .output();
        out.map(|o| o.status.success()).unwrap_or(false)
    }
    #[cfg(not(target_os = "macos"))]
    false
}
