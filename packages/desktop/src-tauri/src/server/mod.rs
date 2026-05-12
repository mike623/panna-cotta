pub mod routes;
pub mod state;

use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use state::AppState;
use tauri::Emitter;

const PORT_FILE_NAME: &str = ".panna-cotta.port";

/// Path to the port-persistence file.
///
/// Production: lives at `$HOME/.panna-cotta.port` (legacy location, preserved
/// for backward compatibility with existing installs).
///
/// Test/sandbox: when `PANNA_CONFIG_DIR` is set, lives inside the override
/// directory so multiple instances don't clobber each other.
fn port_file() -> std::path::PathBuf {
    if let Ok(override_dir) = std::env::var("PANNA_CONFIG_DIR") {
        if !override_dir.is_empty() {
            return std::path::PathBuf::from(override_dir).join(PORT_FILE_NAME);
        }
    }
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
            let pf = port_file();
            if let Some(parent) = pf.parent() {
                let _ = tokio::fs::create_dir_all(parent).await;
            }
            tokio::fs::write(&pf, p.to_string())
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

    // E2E test hook: when PANNA_CONFIG_DIR is set, write the CSRF token to a
    // file inside the override dir so test harnesses can authenticate.
    // Production (no override) never writes this file.
    if let Ok(override_dir) = std::env::var("PANNA_CONFIG_DIR") {
        if !override_dir.is_empty() {
            let token_path = std::path::PathBuf::from(&override_dir).join(".csrf-token");
            if let Some(parent) = token_path.parent() {
                let _ = tokio::fs::create_dir_all(parent).await;
            }
            if let Err(e) = tokio::fs::write(&token_path, &state.csrf_token).await {
                tracing::warn!(error = %e, "failed to write .csrf-token");
            }
        }
    }

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
        if let Err(e) = host.spawn_plugin(&plugin.manifest.uuid, &node_binary, &code_path, &plugin.plugin_dir, port).await {
            tracing::error!(uuid = %plugin.manifest.uuid, error = %e, "plugin spawn failed");
        }
    }
}

/// Copy built-in .sdPlugin dirs from Tauri resource dir to ~/.panna-cotta/plugins/.
/// Refreshes dest when the bundled manifest `Version` differs from the installed
/// one (or dest manifest is unreadable). Missing dest → fresh copy.
pub async fn copy_builtin_plugins(
    resource_plugins_dir: &std::path::Path,
    dest_plugins_dir: &std::path::Path,
) -> Result<(), String> {
    tokio::fs::create_dir_all(dest_plugins_dir)
        .await
        .map_err(|e| format!("create plugins dir: {e}"))?;

    let mut entries = tokio::fs::read_dir(resource_plugins_dir)
        .await
        .map_err(|e| format!("read resource plugins dir: {e}"))?;

    while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if !name_str.ends_with(".sdPlugin") {
            continue;
        }
        let src = entry.path();
        let dest = dest_plugins_dir.join(&name);

        let dest_exists = tokio::fs::try_exists(&dest).await.unwrap_or(false);
        if dest_exists {
            let src_v = read_manifest_version(&src).await;
            let dest_v = read_manifest_version(&dest).await;
            if src_v.is_some() && src_v == dest_v {
                continue;
            }
            tracing::info!(
                plugin = %name_str,
                from = ?dest_v,
                to = ?src_v,
                "built-in plugin version drift, refreshing"
            );
            tokio::fs::remove_dir_all(&dest)
                .await
                .map_err(|e| format!("remove stale {name_str}: {e}"))?;
        }

        copy_dir_all(&src, &dest)
            .await
            .map_err(|e| format!("copy {name_str}: {e}"))?;
        tracing::info!("installed built-in plugin: {name_str}");
    }
    Ok(())
}

/// Reads the `Version` field from `<plugin_dir>/manifest.json`. None on any error.
async fn read_manifest_version(plugin_dir: &std::path::Path) -> Option<String> {
    let bytes = tokio::fs::read(plugin_dir.join("manifest.json")).await.ok()?;
    let v: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    v.get("Version")?.as_str().map(|s| s.to_string())
}

async fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    tokio::fs::create_dir_all(dst).await?;
    let mut entries = tokio::fs::read_dir(src).await?;
    while let Some(entry) = entries.next_entry().await? {
        let ty = entry.file_type().await?;
        let dst_path = dst.join(entry.file_name());
        if ty.is_dir() {
            Box::pin(copy_dir_all(&entry.path(), &dst_path)).await?;
        } else if ty.is_file() {
            tokio::fs::copy(&entry.path(), &dst_path).await?;
        } else {
            tracing::warn!("skipping non-file entry in plugin bundle: {:?}", entry.path());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn resolve_port_finds_free_port() {
        let port = resolve_port().await.unwrap();
        assert!((30000..40000).contains(&port));
    }

    #[tokio::test]
    async fn copy_builtin_plugins_creates_dest_dir() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        let plugin_src = src.path().join("com.test.sdPlugin");
        tokio::fs::create_dir(&plugin_src).await.unwrap();
        tokio::fs::write(plugin_src.join("manifest.json"), b"{}").await.unwrap();

        copy_builtin_plugins(src.path(), dst.path()).await.unwrap();

        assert!(dst.path().join("com.test.sdPlugin").join("manifest.json").exists());
    }

    #[tokio::test]
    async fn copy_builtin_plugins_refreshes_on_version_bump() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();

        let plugin_src = src.path().join("com.test.sdPlugin");
        tokio::fs::create_dir(&plugin_src).await.unwrap();
        tokio::fs::write(
            plugin_src.join("manifest.json"),
            br#"{"Version":"1.0.1"}"#,
        ).await.unwrap();
        tokio::fs::write(plugin_src.join("code.js"), b"NEW").await.unwrap();

        let plugin_dst = dst.path().join("com.test.sdPlugin");
        tokio::fs::create_dir(&plugin_dst).await.unwrap();
        tokio::fs::write(
            plugin_dst.join("manifest.json"),
            br#"{"Version":"1.0.0"}"#,
        ).await.unwrap();
        tokio::fs::write(plugin_dst.join("code.js"), b"OLD").await.unwrap();
        tokio::fs::write(plugin_dst.join("stale.txt"), b"removeme").await.unwrap();

        copy_builtin_plugins(src.path(), dst.path()).await.unwrap();

        let manifest = tokio::fs::read_to_string(plugin_dst.join("manifest.json")).await.unwrap();
        assert!(manifest.contains("1.0.1"));
        let code = tokio::fs::read_to_string(plugin_dst.join("code.js")).await.unwrap();
        assert_eq!(code, "NEW");
        assert!(!plugin_dst.join("stale.txt").exists(), "stale file must be removed");
    }

    #[tokio::test]
    async fn copy_builtin_plugins_skips_when_version_matches() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();

        let plugin_src = src.path().join("com.test.sdPlugin");
        tokio::fs::create_dir(&plugin_src).await.unwrap();
        tokio::fs::write(
            plugin_src.join("manifest.json"),
            br#"{"Version":"1.0.0"}"#,
        ).await.unwrap();
        tokio::fs::write(plugin_src.join("code.js"), b"NEW").await.unwrap();

        let plugin_dst = dst.path().join("com.test.sdPlugin");
        tokio::fs::create_dir(&plugin_dst).await.unwrap();
        tokio::fs::write(
            plugin_dst.join("manifest.json"),
            br#"{"Version":"1.0.0"}"#,
        ).await.unwrap();
        tokio::fs::write(plugin_dst.join("code.js"), b"OLD").await.unwrap();

        copy_builtin_plugins(src.path(), dst.path()).await.unwrap();

        let code = tokio::fs::read_to_string(plugin_dst.join("code.js")).await.unwrap();
        assert_eq!(code, "OLD", "matching version must not overwrite");
    }
}
