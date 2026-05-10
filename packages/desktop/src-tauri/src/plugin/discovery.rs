use std::collections::hash_map::Entry;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::plugin::manifest::{validate, Manifest};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PluginSource {
    Dropin,
    Npm,
}

#[derive(Debug, Clone)]
pub struct DiscoveredPlugin {
    pub manifest: Manifest,
    pub plugin_dir: PathBuf,
    pub source: PluginSource,
}

/// Scan `{config_dir}/plugins/*.sdPlugin/` for installed plugins.
/// Dropin source beats Npm. Within same source, alphabetically first directory wins on UUID collision.
pub async fn scan_plugins(config_dir: &Path) -> Vec<DiscoveredPlugin> {
    let mut found: HashMap<String, DiscoveredPlugin> = HashMap::new();
    let plugins_dir = config_dir.join("plugins");

    let mut entries = match tokio::fs::read_dir(&plugins_dir).await {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return vec![],
        Err(e) => {
            tracing::warn!(dir=%plugins_dir.display(), error=%e, "failed to open plugins directory");
            return vec![];
        }
    };

    let mut dirs: Vec<PathBuf> = Vec::new();
    loop {
        match entries.next_entry().await {
            Ok(Some(e)) => {
                let p = e.path();
                let is_dir = e.file_type().await.map(|t| t.is_dir()).unwrap_or(false);
                if p.extension().and_then(|ext| ext.to_str()) == Some("sdPlugin") && is_dir {
                    dirs.push(p);
                }
            }
            Ok(None) => break,
            Err(e) => {
                tracing::warn!(dir=%plugins_dir.display(), error=%e, "error reading plugin dir entry, scan may be incomplete");
                break;
            }
        }
    }
    dirs.sort();

    for dir in dirs {
        if let Some(plugin) = load_plugin(&dir, PluginSource::Dropin).await {
            let uuid = plugin.manifest.uuid.clone();
            debug_assert_eq!(plugin.source, PluginSource::Dropin, "Npm source scanning not yet implemented; update dedup logic when adding Npm");
            match found.entry(uuid) {
                Entry::Vacant(e) => { e.insert(plugin); }
                Entry::Occupied(mut e) => {
                    // Dropin beats Npm; Npm source is not yet scanned (Plan 3) but the rule is enforced here
                    if plugin.source == PluginSource::Dropin && e.get().source == PluginSource::Npm {
                        e.insert(plugin);
                    }
                    // same source: dirs sorted alphabetically, first inserted wins (no update needed)
                }
            }
        }
    }

    let mut result: Vec<DiscoveredPlugin> = found.into_values().collect();
    result.sort_by(|a, b| a.manifest.uuid.cmp(&b.manifest.uuid));
    result
}

async fn load_plugin(dir: &Path, source: PluginSource) -> Option<DiscoveredPlugin> {
    let manifest_path = dir.join("manifest.json");
    let data = tokio::fs::read_to_string(&manifest_path).await
        .map_err(|e| tracing::warn!(path=%manifest_path.display(), error=%e, "manifest read error"))
        .ok()?;
    let manifest: Manifest = serde_json::from_str(&data)
        .map_err(|e| tracing::warn!(path=%manifest_path.display(), error=%e, "manifest parse error"))
        .ok()?;
    match validate(&manifest, dir) {
        Ok(()) => Some(DiscoveredPlugin { manifest, plugin_dir: dir.to_path_buf(), source }),
        Err(e) => {
            tracing::warn!(dir=%dir.display(), error=%e, "manifest validation failed, skipping plugin");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn write_manifest(dir: &Path, uuid: &str, code_path: &str) {
        let manifest = serde_json::json!({
            "UUID": uuid,
            "Name": "Test Plugin",
            "SDKVersion": 2,
            "CodePath": code_path,
            "Actions": [{"UUID": format!("{}.action", uuid), "Name": "Act"}]
        });
        fs::write(dir.join("manifest.json"), manifest.to_string()).unwrap();
    }

    #[tokio::test]
    async fn empty_plugins_dir_returns_empty() {
        let tmp = TempDir::new().unwrap();
        let result = scan_plugins(tmp.path()).await;
        assert!(result.is_empty());
    }

    #[tokio::test]
    async fn valid_sdplugin_discovered() {
        let tmp = TempDir::new().unwrap();
        let plugin_dir = tmp.path().join("plugins").join("com.example.test.sdPlugin");
        fs::create_dir_all(&plugin_dir).unwrap();
        write_manifest(&plugin_dir, "com.example.test", "bin/plugin.js");
        let result = scan_plugins(tmp.path()).await;
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].manifest.uuid, "com.example.test");
        assert_eq!(result[0].source, PluginSource::Dropin);
    }

    #[tokio::test]
    async fn invalid_manifest_skipped() {
        let tmp = TempDir::new().unwrap();
        let plugin_dir = tmp.path().join("plugins").join("bad.sdPlugin");
        fs::create_dir_all(&plugin_dir).unwrap();
        fs::write(plugin_dir.join("manifest.json"), r#"{"UUID": "", "CodePath": "x.js"}"#).unwrap();
        let result = scan_plugins(tmp.path()).await;
        assert!(result.is_empty());
    }

    #[tokio::test]
    async fn duplicate_uuid_alphabetically_first_wins() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path().join("plugins");
        let dir_a = base.join("aaa.sdPlugin");
        let dir_b = base.join("zzz.sdPlugin");
        fs::create_dir_all(&dir_a).unwrap();
        fs::create_dir_all(&dir_b).unwrap();
        write_manifest(&dir_a, "com.same.uuid", "bin/plugin.js");
        write_manifest(&dir_b, "com.same.uuid", "bin/plugin.js");
        let result = scan_plugins(tmp.path()).await;
        assert_eq!(result.len(), 1);
        assert!(result[0].plugin_dir.ends_with("aaa.sdPlugin"));
    }

    #[tokio::test]
    async fn non_sdplugin_dirs_ignored() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path().join("plugins");
        fs::create_dir_all(base.join("not-a-plugin")).unwrap();
        fs::create_dir_all(base.join("also.notplugin")).unwrap();
        let result = scan_plugins(tmp.path()).await;
        assert!(result.is_empty());
    }
}
