use std::sync::Arc;
use tauri::State;

use crate::server::state::{
    activate_profile, create_profile, default_config, delete_profile, list_profiles,
    rename_profile, save_stream_deck_config, use_stream_deck_config, AppState, Profile,
    StreamDeckConfig,
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
pub async fn open_config_folder(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let dir = state.config_dir.to_string_lossy().to_string();
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg(&dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_csrf_token(state: State<'_, Arc<AppState>>) -> String {
    state.csrf_token.clone()
}
