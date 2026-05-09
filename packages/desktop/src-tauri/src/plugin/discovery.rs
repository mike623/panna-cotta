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

    if let Ok(mut entries) = tokio::fs::read_dir(&plugins_dir).await {
        let mut dirs: Vec<PathBuf> = Vec::new();
        while let Ok(Some(e)) = entries.next_entry().await {
            let p = e.path();
            if p.extension().and_then(|e| e.to_str()) == Some("sdPlugin") && p.is_dir() {
                dirs.push(p);
            }
        }
        dirs.sort();

        for dir in dirs {
            if let Some(plugin) = load_plugin(&dir, PluginSource::Dropin).await {
                let uuid = plugin.manifest.uuid.clone();
                match found.entry(uuid) {
                    Entry::Vacant(e) => { e.insert(plugin); }
                    Entry::Occupied(mut e) => {
                        if plugin.source == PluginSource::Dropin && e.get().source == PluginSource::Npm {
                            e.insert(plugin);
                        }
                        // same source: dirs sorted alphabetically, first inserted wins
                    }
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
    async fn duplicate_uuid_dropin_wins_alphabetically() {
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
