use std::sync::Arc;
use serde::Serialize;
use tauri::State;
use crate::server::state::AppState;

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
}
