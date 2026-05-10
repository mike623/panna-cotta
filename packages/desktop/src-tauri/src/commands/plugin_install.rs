use std::path::{Path, PathBuf};

#[derive(Debug)]
pub struct InstallResult {
    pub uuid: String,
    pub name: String,
}

/// Full install flow: download → unzip → validate → place → return uuid+name.
pub async fn install_from_url(
    url: &str,
    config_dir: &Path,
) -> Result<InstallResult, String> {
    if !url.starts_with("https://") {
        return Err(format!("URL must use https, got: {url}"));
    }

    let bytes = download_plugin(url).await?;
    let sdplugin_dir = extract_plugin(&bytes, config_dir).await?;
    let result = load_plugin_dir(&sdplugin_dir, config_dir).await?;
    Ok(result)
}

/// Download URL to bytes, aborting if > 50 MB.
async fn download_plugin(url: &str) -> Result<Vec<u8>, String> {
    const MAX_BYTES: usize = 50 * 1024 * 1024;
    let resp = reqwest::get(url).await.map_err(|e| format!("download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("download HTTP {}", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| format!("download body: {e}"))?;
    if bytes.len() > MAX_BYTES {
        return Err(format!("plugin ZIP exceeds 50 MB ({} bytes)", bytes.len()));
    }
    Ok(bytes.to_vec())
}

/// Extract the first .sdPlugin directory from a ZIP into a temp location.
/// Returns the path to the extracted .sdPlugin dir.
async fn extract_plugin(bytes: &[u8], config_dir: &Path) -> Result<PathBuf, String> {
    let bytes = bytes.to_vec();
    let config_dir = config_dir.to_path_buf();
    tokio::task::spawn_blocking(move || extract_plugin_sync(&bytes, &config_dir))
        .await
        .map_err(|e| format!("extract task: {e}"))?
}

fn extract_plugin_sync(bytes: &[u8], config_dir: &Path) -> Result<PathBuf, String> {
    use std::io::Cursor;
    let cursor = Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("invalid ZIP: {e}"))?;

    // Collect all file names first
    let names: Vec<String> = (0..archive.len())
        .map(|i| archive.by_index_raw(i).map(|f| f.name().to_string()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("ZIP scan: {e}"))?;

    let sdplugin_root = find_sdplugin_root_from_names(&names)?;

    let tmp_dir = config_dir.join("plugins").join(".install-tmp");
    let dest = tmp_dir.join(sdplugin_root.trim_end_matches('/'));
    std::fs::create_dir_all(&tmp_dir).map_err(|e| format!("mkdir tmp: {e}"))?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| format!("ZIP entry {i}: {e}"))?;
        let raw_name = file.name().to_string();

        if raw_name.contains("..") || raw_name.starts_with('/') {
            let _ = std::fs::remove_dir_all(&tmp_dir);
            return Err(format!("ZIP contains unsafe path: {raw_name}"));
        }
        if !raw_name.starts_with(&sdplugin_root) { continue; }

        let rel = raw_name[sdplugin_root.len()..].trim_start_matches('/');
        if rel.is_empty() { continue; }

        let out_path = dest.join(rel);
        if file.is_dir() {
            std::fs::create_dir_all(&out_path).map_err(|e| format!("mkdir {rel}: {e}"))?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("mkdir parent: {e}"))?;
            }
            let mut out = std::fs::File::create(&out_path)
                .map_err(|e| format!("create {rel}: {e}"))?;
            std::io::copy(&mut file, &mut out).map_err(|e| format!("write {rel}: {e}"))?;
        }
    }
    Ok(dest)
}

fn find_sdplugin_root_from_names(names: &[String]) -> Result<String, String> {
    for name in names {
        let parts: Vec<&str> = name.splitn(2, '/').collect();
        if parts[0].ends_with(".sdPlugin") {
            return Ok(format!("{}/", parts[0]));
        }
    }
    Err("no .sdPlugin directory found in ZIP".into())
}

/// Validate the extracted manifest and move the .sdPlugin dir to plugins/.
async fn load_plugin_dir(sdplugin_dir: &Path, config_dir: &Path) -> Result<InstallResult, String> {
    let manifest_path = sdplugin_dir.join("manifest.json");
    let raw = tokio::fs::read_to_string(&manifest_path)
        .await
        .map_err(|e| format!("read manifest: {e}"))?;
    let manifest: crate::plugin::manifest::Manifest =
        serde_json::from_str(&raw).map_err(|e| format!("parse manifest: {e}"))?;
    crate::plugin::manifest::validate(&manifest, sdplugin_dir)?;

    let dest = config_dir
        .join("plugins")
        .join(format!("{}.sdPlugin", manifest.uuid));
    if dest.exists() {
        tokio::fs::remove_dir_all(&dest)
            .await
            .map_err(|e| format!("remove old plugin: {e}"))?;
    }
    tokio::fs::rename(sdplugin_dir, &dest)
        .await
        .map_err(|e| format!("move plugin: {e}"))?;

    // Clean up the .install-tmp dir if empty
    let tmp = config_dir.join("plugins").join(".install-tmp");
    let _ = tokio::fs::remove_dir(&tmp).await;

    Ok(InstallResult {
        uuid: manifest.uuid,
        name: manifest.name,
    })
}

/// Entry point called by the deep-link handler.
/// Downloads, installs, and hot-loads the plugin. Fires Tauri events.
pub async fn handle_deep_link(
    raw_url: &str,
    state: &std::sync::Arc<crate::server::state::AppState>,
    app: &tauri::AppHandle,
) {
    use tauri::Emitter;

    let plugin_url = match extract_plugin_url(raw_url) {
        Some(u) => u,
        None => {
            tracing::warn!(url=%raw_url, "deep link: unrecognised URL format");
            return;
        }
    };

    tracing::info!(url=%plugin_url, "deep link: installing plugin");

    match install_from_url(&plugin_url, &state.config_dir).await {
        Ok(result) => {
            hot_load_plugin(&result.uuid, state, app).await;
            let _ = app.emit("plugin-installed", serde_json::json!({
                "ok": true,
                "uuid": result.uuid,
                "name": result.name,
            }));
        }
        Err(e) => {
            tracing::error!(error=%e, "deep link: install failed");
            let _ = app.emit("plugin-installed", serde_json::json!({
                "ok": false,
                "error": e,
            }));
        }
    }
}

fn extract_plugin_url(raw_url: &str) -> Option<String> {
    let parsed = url::Url::parse(raw_url).ok()?;
    if parsed.scheme() != "streamdeck" { return None; }
    parsed.query_pairs()
        .find(|(k, _)| k == "url")
        .map(|(_, v)| v.into_owned())
}

async fn hot_load_plugin(
    uuid: &str,
    state: &std::sync::Arc<crate::server::state::AppState>,
    app: &tauri::AppHandle,
) {
    let discovered = crate::plugin::discovery::scan_plugins(&state.config_dir).await;
    let new_plugin = match discovered.iter().find(|p| p.manifest.uuid == uuid) {
        Some(p) => p.clone(),
        None => {
            tracing::warn!(uuid=%uuid, "hot_load: plugin not found after install");
            return;
        }
    };

    {
        let mut host = state.plugin_host.lock().await;
        host.manifests.insert(new_plugin.manifest.uuid.clone(), new_plugin.manifest.clone());
        host.plugin_dirs.insert(new_plugin.manifest.uuid.clone(), new_plugin.plugin_dir.clone());
        for action in &new_plugin.manifest.actions {
            host.registry.insert(action.uuid.clone(), new_plugin.manifest.uuid.clone());
        }
    }

    let port = state.port.lock().ok().and_then(|g| *g).unwrap_or(0);
    let node_binary = match crate::plugin::runtime::resolve_node_binary(&state.config_dir).await {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(error=%e, "hot_load: no node binary");
            use tauri::Emitter;
            let _ = app.emit("node-runtime-needed", ());
            return;
        }
    };

    let mut host = state.plugin_host.lock().await;
    let code_path = new_plugin.plugin_dir.join(&new_plugin.manifest.code_path);
    if let Err(e) = host.spawn_plugin(uuid, &node_binary, &code_path, port).await {
        tracing::error!(uuid=%uuid, error=%e, "hot_load: spawn failed");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn make_valid_zip(uuid: &str) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let cursor = std::io::Cursor::new(&mut buf);
            let mut zip = zip::ZipWriter::new(cursor);
            let options = zip::write::SimpleFileOptions::default();
            zip.add_directory(format!("{uuid}.sdPlugin/"), options).unwrap();
            zip.start_file(format!("{uuid}.sdPlugin/manifest.json"), options).unwrap();
            let manifest = serde_json::json!({
                "UUID": uuid,
                "Name": "Test Plugin",
                "SDKVersion": 2,
                "CodePath": "bin/plugin.js",
                "Actions": [{"UUID": format!("{uuid}.action"), "Name": "Act"}]
            });
            zip.write_all(manifest.to_string().as_bytes()).unwrap();
            zip.add_directory(format!("{uuid}.sdPlugin/bin/"), options).unwrap();
            zip.start_file(format!("{uuid}.sdPlugin/bin/plugin.js"), options).unwrap();
            zip.write_all(b"// plugin").unwrap();
            zip.finish().unwrap();
        }
        buf
    }

    #[tokio::test]
    async fn rejects_non_https_url() {
        let dir = tempfile::tempdir().unwrap();
        let result = install_from_url("http://example.com/plugin.zip", dir.path()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("https"));
    }

    #[tokio::test]
    async fn rejects_path_traversal_in_zip() {
        let dir = tempfile::tempdir().unwrap();
        tokio::fs::create_dir_all(dir.path().join("plugins")).await.unwrap();
        let mut buf = Vec::new();
        {
            let cursor = std::io::Cursor::new(&mut buf);
            let mut zip = zip::ZipWriter::new(cursor);
            let options = zip::write::SimpleFileOptions::default();
            zip.start_file("com.evil.sdPlugin/../../../etc/passwd", options).unwrap();
            zip.write_all(b"evil").unwrap();
            zip.finish().unwrap();
        }
        let result = extract_plugin(&buf, dir.path()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("unsafe path"));
    }

    #[tokio::test]
    async fn happy_path_extracts_and_validates() {
        let dir = tempfile::tempdir().unwrap();
        tokio::fs::create_dir_all(dir.path().join("plugins")).await.unwrap();
        let uuid = "com.test.myplugin";
        let bytes = make_valid_zip(uuid);
        let sdplugin_path = extract_plugin(&bytes, dir.path()).await.unwrap();
        assert!(sdplugin_path.join("manifest.json").exists());
        assert!(sdplugin_path.join("bin").join("plugin.js").exists());
        let result = load_plugin_dir(&sdplugin_path, dir.path()).await.unwrap();
        assert_eq!(result.uuid, uuid);
        let installed = dir.path().join("plugins").join(format!("{uuid}.sdPlugin"));
        assert!(installed.join("manifest.json").exists());
    }

    #[test]
    fn extract_plugin_url_parses_streamdeck_scheme() {
        let url = "streamdeck://plugins/install?url=https://example.com/plugin.zip";
        assert_eq!(
            extract_plugin_url(url),
            Some("https://example.com/plugin.zip".into())
        );
    }

    #[test]
    fn extract_plugin_url_returns_none_for_unknown_scheme() {
        assert!(extract_plugin_url("https://example.com/foo").is_none());
    }
}
