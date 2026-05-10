use std::sync::Arc;
use serde::Serialize;
use tauri::State;
use crate::server::state::AppState;

/// Validates that a plugin UUID is safe to use in filesystem paths.
/// Rejects UUIDs containing path traversal sequences, slashes, or null bytes.
fn is_valid_plugin_uuid(uuid: &str) -> bool {
    !uuid.is_empty()
        && !uuid.contains('/')
        && !uuid.contains('\\')
        && !uuid.contains("..")
        && !uuid.contains('\0')
}

#[derive(Serialize)]
pub struct ActionDto {
    pub uuid: String,
    pub name: String,
    #[serde(rename = "piPath", skip_serializing_if = "Option::is_none")]
    pub pi_path: Option<String>,
}

#[derive(Serialize)]
pub struct PluginDto {
    pub uuid: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub status: String,
    pub actions: Vec<ActionDto>,
}

#[tauri::command]
pub async fn list_plugins_cmd(state: State<'_, Arc<AppState>>) -> Result<Vec<PluginDto>, String> {
    let plugins: Vec<PluginDto> = {
        let host = state.plugin_host.lock().await;
        host.manifests.iter().map(|(uuid, manifest)| {
            let status = host.plugins.get(uuid)
                .map(|ps| match &ps.status {
                    crate::plugin::PluginStatus::Running    => "running",
                    crate::plugin::PluginStatus::Starting   => "starting",
                    crate::plugin::PluginStatus::Stopped    => "stopped",
                    crate::plugin::PluginStatus::Errored(_) => "errored",
                })
                .unwrap_or("not_spawned")
                .to_string();
            PluginDto {
                uuid: uuid.clone(),
                name: manifest.name.clone(),
                version: manifest.version.clone(),
                author: manifest.author.clone(),
                description: manifest.description.clone(),
                status,
                actions: manifest.actions.iter().map(|a| ActionDto {
                    uuid: a.uuid.clone(),
                    name: a.name.clone(),
                    pi_path: a.property_inspector_path.clone(),
                }).collect(),
            }
        }).collect()
    }; // guard dropped here
    Ok(plugins)
}

#[derive(Serialize)]
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

pub async fn read_global_settings(config_dir: &std::path::Path, plugin_uuid: &str) -> serde_json::Value {
    // Reject invalid UUIDs to prevent path traversal attacks
    if !is_valid_plugin_uuid(plugin_uuid) {
        return serde_json::json!({});
    }

    let path = config_dir.join("globals").join(format!("{}.json", plugin_uuid));
    match tokio::fs::read_to_string(&path).await {
        Ok(raw) => match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(plugin_uuid=%plugin_uuid, error=%e, "corrupt global settings file, returning empty");
                serde_json::json!({})
            }
        },
        Err(_) => serde_json::json!({}),
    }
}

pub async fn write_global_settings(
    config_dir: &std::path::Path,
    plugin_uuid: &str,
    value: &serde_json::Value,
) -> Result<(), String> {
    // Reject invalid UUIDs to prevent path traversal attacks
    if !is_valid_plugin_uuid(plugin_uuid) {
        return Err("invalid plugin uuid".to_string());
    }

    let globals_dir = config_dir.join("globals");
    tokio::fs::create_dir_all(&globals_dir).await.map_err(|e| e.to_string())?;
    let path = globals_dir.join(format!("{}.json", plugin_uuid));

    // Create unique temp filename to avoid concurrent write races
    let tmp_name = format!(
        "{}.json.{}.tmp",
        plugin_uuid,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    );
    let tmp = globals_dir.join(tmp_name);

    let json = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    tokio::fs::write(&tmp, json).await.map_err(|e| e.to_string())?;

    // Clean up temp file on rename failure
    if let Err(e) = tokio::fs::rename(&tmp, &path).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(e.to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[tokio::test]
    async fn read_global_settings_rejects_path_traversal() {
        let dir = tempfile::tempdir().unwrap();
        let result = read_global_settings(dir.path(), "../../etc/passwd").await;
        assert_eq!(result, serde_json::json!({}));
    }

    #[tokio::test]
    async fn write_global_settings_rejects_path_traversal() {
        let dir = tempfile::tempdir().unwrap();
        let err = write_global_settings(dir.path(), "../escape", &serde_json::json!({})).await;
        assert!(err.is_err());
    }

    #[tokio::test]
    async fn write_global_settings_rejects_slashes() {
        let dir = tempfile::tempdir().unwrap();
        assert!(write_global_settings(dir.path(), "evil/uuid", &serde_json::json!({})).await.is_err());
        assert!(write_global_settings(dir.path(), "evil\\uuid", &serde_json::json!({})).await.is_err());
    }

    #[tokio::test]
    async fn read_global_settings_returns_empty_on_corrupt_file() {
        let dir = tempfile::tempdir().unwrap();
        let globals = dir.path().join("globals");
        tokio::fs::create_dir_all(&globals).await.unwrap();
        tokio::fs::write(globals.join("com.test.plugin.json"), "not json {{{").await.unwrap();
        let result = read_global_settings(dir.path(), "com.test.plugin").await;
        assert_eq!(result, serde_json::json!({}));
    }
}
