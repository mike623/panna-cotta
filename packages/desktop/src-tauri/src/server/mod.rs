pub mod routes;
pub mod state;

use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use state::AppState;
use tauri::Emitter;

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
    state.initialize().await?;

    let port = resolve_port().await?;
    let router = routes::create_router(state.clone());
    let listener = TcpListener::bind(format!("0.0.0.0:{port}"))
        .await
        .map_err(|e| e.to_string())?;

    *state.port.lock().map_err(|e| e.to_string())? = Some(port);

    tracing::info!(port, "server bound");

    tauri::async_runtime::spawn(async move {
        axum::serve(listener, router.into_make_service_with_connect_info::<SocketAddr>()).await.expect("axum server failed");
    });

    tracing::info!("plugin runtime ready");
    Ok(port)
}

/// Called after the Axum server is live. Discovers plugins, resolves Node.js,
/// and spawns all installed plugins. Non-fatal: logs errors, emits Tauri event
/// if Node.js is not found.
pub async fn post_start_spawn(state: Arc<AppState>, app: &tauri::AppHandle) {
    let port = state.port.lock().ok().and_then(|g| *g).unwrap_or(0);

    let discovered = crate::plugin::discovery::scan_plugins(&state.config_dir).await;
    tracing::info!(count = discovered.len(), "plugins discovered");

    {
        let mut host = state.plugin_host.lock().await;
        for plugin in &discovered {
            host.manifests.insert(plugin.manifest.uuid.clone(), plugin.manifest.clone());
            host.plugin_dirs.insert(plugin.manifest.uuid.clone(), plugin.plugin_dir.clone());
            for action in &plugin.manifest.actions {
                host.registry.insert(action.uuid.clone(), plugin.manifest.uuid.clone());
            }
        }
    }

    if discovered.is_empty() {
        tracing::info!("no plugins to spawn");
        return;
    }

    let node_binary = match crate::plugin::runtime::resolve_node_binary(&state.config_dir).await {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(error = %e, "node binary not found");
            let _ = app.emit("node-runtime-needed", ());
            return;
        }
    };

    let mut host = state.plugin_host.lock().await;
    for plugin in &discovered {
        let code_path = plugin.plugin_dir.join(&plugin.manifest.code_path);
        if let Err(e) = host.spawn_plugin(&plugin.manifest.uuid, &node_binary, &code_path, port).await {
            tracing::error!(uuid = %plugin.manifest.uuid, error = %e, "plugin spawn failed");
        }
    }
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
