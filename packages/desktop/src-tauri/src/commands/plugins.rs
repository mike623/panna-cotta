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
