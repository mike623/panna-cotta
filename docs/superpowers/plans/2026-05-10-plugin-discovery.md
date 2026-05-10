# Plugin Manifest Parsing & Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discover `.sdPlugin` packages on disk, parse + validate their manifests, resolve Node.js, spawn plugins after the Axum server starts, fire `deviceDidConnect` + `willAppear` events when plugins connect, and expose `/api/plugins` for status visibility.

**Architecture:** Three new focused modules (`manifest.rs`, `discovery.rs`, `runtime.rs`) added to `src/plugin/`. `PluginHost` gains `manifests` and `plugin_dirs` fields populated at startup. `server/mod.rs` gets `post_start_spawn()` called from `app.rs` after the WS endpoint is live. The WS registration handler fires startup lifecycle events. `/api/plugins` provides read-only visibility.

**Tech Stack:** Rust, Tokio async FS, serde_json, existing `rand` + `mime_guess` crates.

**This is Plan 2 of 4.** Plan 1 = plugin runtime core (done). Plan 3 = profile switch lifecycle + PI + built-in plugins. Plan 4 = admin UI.

---

## File Map

**Create:**
- `src/plugin/manifest.rs` — `Manifest`, `Action`, `OsEntry` structs; `validate()` + `validate_with_platform()`
- `src/plugin/discovery.rs` — `DiscoveredPlugin`, `PluginSource`, `scan_plugins()`
- `src/plugin/runtime.rs` — `resolve_node_binary()`, `check_node_version()`

**Modify:**
- `src/plugin/mod.rs` — add `pub mod manifest/discovery/runtime`; add `manifests: HashMap<String, Manifest>` and `plugin_dirs: HashMap<String, PathBuf>` to `PluginHost::new()`
- `src/server/mod.rs` — add `post_start_spawn(state, app)` async function
- `src/app.rs` — call `post_start_spawn` after server starts successfully
- `src/plugin/ws.rs` — fire `deviceDidConnect` + `willAppear` after plugin registers
- `src/server/routes.rs` — add `/api/plugins` GET, `/api/plugins/:uuid/status` GET, stub POST install + DELETE uninstall

All paths relative to `packages/desktop/src-tauri/`.

---

### Task 1: Manifest parser

**Files:** Create `src/plugin/manifest.rs`

- [ ] **Step 1: Write failing tests**

Create `src/plugin/manifest.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn valid() -> Manifest {
        Manifest {
            uuid: "com.example.plugin".into(),
            name: "Test".into(),
            version: "1.0.0".into(),
            author: "Author".into(),
            description: "desc".into(),
            sdk_version: 2,
            code_path: "bin/plugin.js".into(),
            os: vec![],
            actions: vec![Action { uuid: "com.example.plugin.action".into(), name: "A".into() }],
        }
    }

    #[test]
    fn valid_manifest_passes() {
        assert!(validate_with_platform(&valid(), Path::new("/tmp"), "mac").is_ok());
    }

    #[test]
    fn missing_uuid_fails() {
        let mut m = valid(); m.uuid = "".into();
        assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_err());
    }

    #[test]
    fn missing_code_path_fails() {
        let mut m = valid(); m.code_path = "".into();
        assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_err());
    }

    #[test]
    fn non_js_code_path_fails() {
        let mut m = valid(); m.code_path = "bin/plugin.ts".into();
        assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_err());
    }

    #[test]
    fn dotdot_code_path_fails() {
        let mut m = valid(); m.code_path = "../evil.js".into();
        assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_err());
    }

    #[test]
    fn absolute_code_path_fails() {
        let mut m = valid(); m.code_path = "/etc/evil.js".into();
        assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_err());
    }

    #[test]
    fn empty_actions_fails() {
        let mut m = valid(); m.actions = vec![];
        assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_err());
    }

    #[test]
    fn duplicate_action_uuids_fail() {
        let mut m = valid();
        m.actions = vec![
            Action { uuid: "com.dup".into(), name: "A".into() },
            Action { uuid: "com.dup".into(), name: "B".into() },
        ];
        assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_err());
    }

    #[test]
    fn sdk_version_too_high_fails() {
        let mut m = valid(); m.sdk_version = 3;
        assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_err());
    }

    #[test]
    fn os_mismatch_fails() {
        let mut m = valid();
        m.os = vec![OsEntry { platform: "windows".into() }];
        assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_err());
    }

    #[test]
    fn os_match_passes() {
        let mut m = valid();
        m.os = vec![OsEntry { platform: "mac".into() }, OsEntry { platform: "windows".into() }];
        assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_ok());
    }

    #[test]
    fn parse_manifest_json() {
        let json = r#"{
            "UUID": "com.example.plugin",
            "Name": "Example",
            "SDKVersion": 2,
            "CodePath": "bin/plugin.js",
            "Actions": [{"UUID": "com.example.plugin.act", "Name": "Act"}]
        }"#;
        let m: Manifest = serde_json::from_str(json).unwrap();
        assert_eq!(m.uuid, "com.example.plugin");
        assert_eq!(m.sdk_version, 2);
        assert_eq!(m.actions.len(), 1);
    }
}
```

- [ ] **Step 2: Run failing tests**

```bash
cd packages/desktop/src-tauri && cargo test plugin::manifest
```

Expected: compile error (module not declared, types not defined).

- [ ] **Step 3: Implement manifest.rs**

Replace `src/plugin/manifest.rs` with the full implementation:

```rust
use std::collections::HashSet;
use std::path::Path;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Manifest {
    #[serde(rename = "UUID")]
    pub uuid: String,
    #[serde(rename = "Name", default)]
    pub name: String,
    #[serde(rename = "Version", default)]
    pub version: String,
    #[serde(rename = "Author", default)]
    pub author: String,
    #[serde(rename = "Description", default)]
    pub description: String,
    #[serde(rename = "SDKVersion", default)]
    pub sdk_version: u32,
    #[serde(rename = "CodePath", default)]
    pub code_path: String,
    #[serde(rename = "OS", default)]
    pub os: Vec<OsEntry>,
    #[serde(rename = "Actions", default)]
    pub actions: Vec<Action>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OsEntry {
    #[serde(rename = "Platform")]
    pub platform: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Action {
    #[serde(rename = "UUID")]
    pub uuid: String,
    #[serde(rename = "Name", default)]
    pub name: String,
}

/// Validate using the actual current platform.
pub fn validate(manifest: &Manifest, plugin_dir: &Path) -> Result<(), String> {
    validate_with_platform(manifest, plugin_dir, current_platform())
}

/// Validate with an explicit platform string (e.g. "mac", "windows", "linux").
/// Used in tests to avoid platform-dependent behavior.
pub fn validate_with_platform(manifest: &Manifest, _plugin_dir: &Path, platform: &str) -> Result<(), String> {
    if manifest.uuid.trim().is_empty() {
        return Err("UUID is missing or empty".into());
    }
    if manifest.code_path.is_empty() {
        return Err("CodePath is missing".into());
    }
    if !manifest.code_path.ends_with(".js") {
        return Err(format!("CodePath must end in .js, got: {}", manifest.code_path));
    }
    let code = Path::new(&manifest.code_path);
    if code.is_absolute() {
        return Err("CodePath must be relative".into());
    }
    if code.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err("CodePath contains '..' and could escape plugin directory".into());
    }
    if manifest.actions.is_empty() {
        return Err("Actions list is empty".into());
    }
    let mut seen = HashSet::new();
    for action in &manifest.actions {
        if !seen.insert(&action.uuid) {
            return Err(format!("Duplicate action UUID: {}", action.uuid));
        }
    }
    if manifest.sdk_version > 2 {
        return Err(format!("SDKVersion {} > 2 is not supported", manifest.sdk_version));
    }
    if !manifest.os.is_empty() {
        let compat = manifest.os.iter().any(|e| e.platform.to_lowercase() == platform);
        if !compat {
            return Err(format!("Plugin not compatible with platform '{platform}'"));
        }
    }
    Ok(())
}

pub fn current_platform() -> &'static str {
    if cfg!(target_os = "macos") { "mac" }
    else if cfg!(target_os = "windows") { "windows" }
    else { "linux" }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn valid() -> Manifest {
        Manifest {
            uuid: "com.example.plugin".into(),
            name: "Test".into(),
            version: "1.0.0".into(),
            author: "Author".into(),
            description: "desc".into(),
            sdk_version: 2,
            code_path: "bin/plugin.js".into(),
            os: vec![],
            actions: vec![Action { uuid: "com.example.plugin.action".into(), name: "A".into() }],
        }
    }

    #[test]
    fn valid_manifest_passes() {
        assert!(validate_with_platform(&valid(), Path::new("/tmp"), "mac").is_ok());
    }

    #[test]
    fn missing_uuid_fails() {
        let mut m = valid(); m.uuid = "".into();
        assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_err());
    }

    #[test]
    fn missing_code_path_fails() {
        let mut m = valid(); m.code_path = "".into();
        assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_err());
    }

    #[test]
    fn non_js_code_path_fails() {
        let mut m = valid(); m.code_path = "bin/plugin.ts".into();
        assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_err());
    }

    #[test]
    fn dotdot_code_path_fails() {
        let mut m = valid(); m.code_path = "../evil.js".into();
        assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_err());
    }

    #[test]
    fn absolute_code_path_fails() {
        let mut m = valid(); m.code_path = "/etc/evil.js".into();
        assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_err());
    }

    #[test]
    fn empty_actions_fails() {
        let mut m = valid(); m.actions = vec![];
        assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_err());
    }

    #[test]
    fn duplicate_action_uuids_fail() {
        let mut m = valid();
        m.actions = vec![
            Action { uuid: "com.dup".into(), name: "A".into() },
            Action { uuid: "com.dup".into(), name: "B".into() },
        ];
        assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_err());
    }

    #[test]
    fn sdk_version_too_high_fails() {
        let mut m = valid(); m.sdk_version = 3;
        assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_err());
    }

    #[test]
    fn os_mismatch_fails() {
        let mut m = valid();
        m.os = vec![OsEntry { platform: "windows".into() }];
        assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_err());
    }

    #[test]
    fn os_match_passes() {
        let mut m = valid();
        m.os = vec![OsEntry { platform: "mac".into() }, OsEntry { platform: "windows".into() }];
        assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_ok());
    }

    #[test]
    fn parse_manifest_json() {
        let json = r#"{
            "UUID": "com.example.plugin",
            "Name": "Example",
            "SDKVersion": 2,
            "CodePath": "bin/plugin.js",
            "Actions": [{"UUID": "com.example.plugin.act", "Name": "Act"}]
        }"#;
        let m: Manifest = serde_json::from_str(json).unwrap();
        assert_eq!(m.uuid, "com.example.plugin");
        assert_eq!(m.sdk_version, 2);
        assert_eq!(m.actions.len(), 1);
    }
}
```

- [ ] **Step 4: Declare module in plugin/mod.rs**

Add to top of `src/plugin/mod.rs` (after `pub mod ws;`):

```rust
pub mod manifest;
```

- [ ] **Step 5: Run tests — expect pass**

```bash
cd packages/desktop/src-tauri && cargo test plugin::manifest
```

Expected: 12 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/plugin/manifest.rs src/plugin/mod.rs
git commit -m "feat: add plugin manifest parser and validation"
```

---

### Task 2: Plugin discovery

**Files:** Create `src/plugin/discovery.rs`

- [ ] **Step 1: Write failing tests**

Create `src/plugin/discovery.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn write_manifest(dir: &std::path::Path, uuid: &str, code_path: &str) {
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
```

- [ ] **Step 2: Run failing tests**

```bash
cd packages/desktop/src-tauri && cargo test plugin::discovery
```

Expected: compile error (module not declared, types not defined).

- [ ] **Step 3: Implement discovery.rs**

Replace `src/plugin/discovery.rs` with the full implementation:

```rust
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
/// Drop-in source always beats Npm. Within same source, alphabetically first
/// directory name wins when UUIDs collide.
pub async fn scan_plugins(config_dir: &Path) -> Vec<DiscoveredPlugin> {
    let mut found: HashMap<String, DiscoveredPlugin> = HashMap::new();
    let plugins_dir = config_dir.join("plugins");

    if let Ok(mut entries) = tokio::fs::read_dir(&plugins_dir).await {
        // Collect and sort entries alphabetically for deterministic dedup
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
                        // Dropin beats Npm; within same source first alphabetically wins
                        if plugin.source == PluginSource::Dropin && e.get().source == PluginSource::Npm {
                            e.insert(plugin);
                        }
                        // same source: dirs sorted, so first inserted wins (no update needed)
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
```

- [ ] **Step 4: Declare module in plugin/mod.rs**

Add after `pub mod manifest;` in `src/plugin/mod.rs`:

```rust
pub mod discovery;
```

- [ ] **Step 5: Run tests — expect pass**

```bash
cd packages/desktop/src-tauri && cargo test plugin::discovery
```

Expected: 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/plugin/discovery.rs src/plugin/mod.rs
git commit -m "feat: add plugin discovery scanner for .sdPlugin directories"
```

---

### Task 3: Node.js runtime resolver

**Files:** Create `src/plugin/runtime.rs`

- [ ] **Step 1: Write failing tests**

Create `src/plugin/runtime.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[tokio::test]
    async fn missing_binary_returns_false() {
        assert!(!check_node_version(Path::new("/definitely/does/not/exist/node")).await);
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn non_node_binary_returns_false() {
        // /bin/sh --version doesn't print "v20+" style output
        assert!(!check_node_version(Path::new("/bin/sh")).await);
    }

    #[tokio::test]
    async fn missing_runtime_dir_tries_system_node() {
        let tmp = tempfile::tempdir().unwrap();
        // tmp dir has no runtime/ subdir, so falls back to system node
        // result depends on whether node >= 20 is installed; just check no panic
        let _ = resolve_node_binary(tmp.path()).await;
    }
}
```

- [ ] **Step 2: Run failing tests**

```bash
cd packages/desktop/src-tauri && cargo test plugin::runtime
```

Expected: compile error.

- [ ] **Step 3: Implement runtime.rs**

Replace `src/plugin/runtime.rs` with:

```rust
use std::path::{Path, PathBuf};
use tokio::process::Command;

/// Find a Node.js binary with version >= 20.
/// Checks bundled runtime first, then system PATH.
pub async fn resolve_node_binary(config_dir: &Path) -> Result<PathBuf, String> {
    let platform_node = if cfg!(windows) { "node.exe" } else { "bin/node" };
    let bundled = config_dir.join("runtime").join(platform_node);
    if bundled.exists() && check_node_version(&bundled).await {
        tracing::info!(path=%bundled.display(), "using bundled node");
        return Ok(bundled);
    }
    if bundled.exists() {
        tracing::warn!(path=%bundled.display(), "bundled node version < 20, trying system node");
    }

    let system = PathBuf::from(if cfg!(windows) { "node.exe" } else { "node" });
    if check_node_version(&system).await {
        tracing::info!("using system node");
        return Ok(system);
    }

    Err("No Node.js >= v20 found. Bundled runtime download required.".into())
}

/// Returns true if the binary at `path` reports Node.js version >= 20.
pub async fn check_node_version(path: &Path) -> bool {
    let output = Command::new(path)
        .arg("--version")
        .output()
        .await;
    match output {
        Ok(o) if o.status.success() => {
            let ver = String::from_utf8_lossy(&o.stdout);
            let major: u32 = ver.trim()
                .trim_start_matches('v')
                .split('.')
                .next()
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            major >= 20
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[tokio::test]
    async fn missing_binary_returns_false() {
        assert!(!check_node_version(Path::new("/definitely/does/not/exist/node")).await);
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn non_node_binary_returns_false() {
        assert!(!check_node_version(Path::new("/bin/sh")).await);
    }

    #[tokio::test]
    async fn missing_runtime_dir_tries_system_node() {
        let tmp = tempfile::tempdir().unwrap();
        let _ = resolve_node_binary(tmp.path()).await;
    }
}
```

- [ ] **Step 4: Declare module in plugin/mod.rs**

Add after `pub mod discovery;` in `src/plugin/mod.rs`:

```rust
pub mod runtime;
```

- [ ] **Step 5: Run tests — expect pass**

```bash
cd packages/desktop/src-tauri && cargo test plugin::runtime
```

Expected: 3 tests pass (non_node_binary_returns_false only runs on Unix).

- [ ] **Step 6: Commit**

```bash
git add src/plugin/runtime.rs src/plugin/mod.rs
git commit -m "feat: add Node.js binary resolver (bundled then system, version >= 20)"
```

---

### Task 4: PluginHost manifest storage + startup spawn

**Files:** `src/plugin/mod.rs`, `src/server/mod.rs`, `src/app.rs`

- [ ] **Step 1: Write failing test**

Add to `plugin/mod.rs` tests:

```rust
#[test]
fn plugin_host_has_manifests_and_dirs() {
    let host = PluginHost::new(default_config());
    assert!(host.manifests.is_empty());
    assert!(host.plugin_dirs.is_empty());
}
```

- [ ] **Step 2: Run failing test**

```bash
cd packages/desktop/src-tauri && cargo test plugin::tests::plugin_host_has_manifests
```

Expected: compile error (fields not defined).

- [ ] **Step 3: Add fields to PluginHost**

In `src/plugin/mod.rs`, update `PluginHost` struct and `new()`:

```rust
pub struct PluginHost {
    pub registry: HashMap<String, String>,
    pub plugins: HashMap<String, PluginState>,
    pub pending_registrations: HashMap<String, Instant>,
    pub pi_token_map: HashMap<String, String>,
    pub profile_state: Arc<tokio::sync::Mutex<StreamDeckConfig>>,
    pub manifests: HashMap<String, crate::plugin::manifest::Manifest>,
    pub plugin_dirs: HashMap<String, std::path::PathBuf>,
}

impl PluginHost {
    pub fn new(config: StreamDeckConfig) -> Self {
        Self {
            registry: HashMap::new(),
            plugins: HashMap::new(),
            pending_registrations: HashMap::new(),
            pi_token_map: HashMap::new(),
            profile_state: Arc::new(tokio::sync::Mutex::new(config)),
            manifests: HashMap::new(),
            plugin_dirs: HashMap::new(),
        }
    }
    // ... existing methods unchanged ...
}
```

- [ ] **Step 4: Run failing test — expect pass**

```bash
cd packages/desktop/src-tauri && cargo test plugin::tests::plugin_host_has_manifests
```

Expected: test passes; all 60 existing tests still pass:

```bash
cargo test 2>&1 | tail -5
```

Expected: `test result: ok. N passed`.

- [ ] **Step 5: Add post_start_spawn to server/mod.rs**

Add after the `start()` function in `src/server/mod.rs`:

```rust
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
            use tauri::Emitter;
            let _ = app.emit("node-runtime-needed", ());
            return;
        }
    };

    let mut host = state.plugin_host.lock().await;
    for plugin in &discovered {
        let code_path = plugin.plugin_dir.join(&plugin.manifest.code_path);
        let node_str = node_binary.to_str().unwrap_or("node");
        let code_str = code_path.to_str().unwrap_or("");
        if let Err(e) = host.spawn_plugin(&plugin.manifest.uuid, node_str, code_str, port).await {
            tracing::error!(uuid = %plugin.manifest.uuid, error = %e, "plugin spawn failed");
        }
    }
}
```

- [ ] **Step 6: Wire post_start_spawn into app.rs**

In `src/app.rs`, locate the `tauri::async_runtime::spawn` block that calls `crate::server::start`. Replace:

```rust
tauri::async_runtime::spawn(async move {
    match crate::server::start(state.clone()).await {
        Ok(port) => update_tray_tooltip(&app_handle, Some(port), true),
        Err(e) => {
            tracing::error!(error = %e, "server failed to start");
            update_tray_tooltip(&app_handle, None, false);
        }
    }
});
```

With:

```rust
tauri::async_runtime::spawn(async move {
    match crate::server::start(state.clone()).await {
        Ok(port) => {
            update_tray_tooltip(&app_handle, Some(port), true);
            crate::server::post_start_spawn(state, &app_handle).await;
        }
        Err(e) => {
            tracing::error!(error = %e, "server failed to start");
            update_tray_tooltip(&app_handle, None, false);
        }
    }
});
```

- [ ] **Step 7: Run all tests**

```bash
cd packages/desktop/src-tauri && cargo test
```

Expected: all tests pass (same count as before + new manifest/discovery/runtime tests).

- [ ] **Step 8: Commit**

```bash
git add src/plugin/mod.rs src/server/mod.rs src/app.rs
git commit -m "feat: store plugin manifests in PluginHost; spawn discovered plugins on startup"
```

---

### Task 5: Post-registration lifecycle events

**Files:** `src/plugin/ws.rs`

When a plugin connects and successfully registers, the host must immediately send:
1. `deviceDidConnect` — tells plugin about the hardware
2. `willAppear` for each button whose `actionUUID` maps to this plugin

- [ ] **Step 1: Write failing test**

Add to `src/server/routes.rs` tests (this tests the overall flow, not ws internals):

Actually the relevant behavior is in `ws.rs`. Write a unit test in `plugin/ws.rs` that we can check after implementation. For now, add this assertion comment to the test plan — the integration test is done manually (start app with a plugin, confirm events fire). The unit test for the helper function is added below.

In `src/plugin/ws.rs` tests section (add `#[cfg(test)]` block at bottom):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_token_from_query_string() {
        assert_eq!(extract_token(Some("token=abc123")), Some("abc123".into()));
        assert_eq!(extract_token(Some("foo=bar&token=xyz&baz=1")), Some("xyz".into()));
        assert_eq!(extract_token(Some("foo=bar")), None);
        assert_eq!(extract_token(None), None);
    }
}
```

- [ ] **Step 2: Run failing test**

```bash
cd packages/desktop/src-tauri && cargo test plugin::ws::tests
```

Expected: compile error (`extract_token` not defined).

- [ ] **Step 3: Add extract_token + fire lifecycle events in ws.rs**

In `src/plugin/ws.rs`:

**a) Add `extract_token` function before `ws_upgrade`:**

```rust
fn extract_token(query: Option<&str>) -> Option<String> {
    query?.split('&')
        .find(|part| part.starts_with("token="))
        .map(|part| part["token=".len()..].to_string())
}
```

**b) In `ws_upgrade`, extract the PI token before consuming the request. Change the handler signature and add token extraction before `let is_pi = ...`:**

Current:
```rust
let is_pi = !origin.is_empty();

let (mut parts, _body) = req.into_parts();
```

Replace with:
```rust
let is_pi = !origin.is_empty();
let pi_token = extract_token(req.uri().query());

let (mut parts, _body) = req.into_parts();
```

**c) Pass `pi_token` to `handle_ws`:**

Change:
```rust
ws.on_upgrade(move |socket| handle_ws(socket, state, is_pi)).into_response()
```

To:
```rust
ws.on_upgrade(move |socket| handle_ws(socket, state, is_pi, pi_token)).into_response()
```

**d) Update `handle_ws` signature:**

Change:
```rust
async fn handle_ws(mut socket: WebSocket, state: Arc<AppState>, is_pi: bool) {
```

To:
```rust
async fn handle_ws(mut socket: WebSocket, state: Arc<AppState>, is_pi: bool, _pi_token: Option<String>) {
```

(PI token handling is implemented in Task 6.)

**e) At the end of `handle_plugin_registration`, after the `tracing::info!(uuid = %uuid, "plugin registered via WS");` line, add the lifecycle event dispatch. Replace:**

```rust
tracing::info!(uuid = %uuid, "plugin registered via WS");

// Split the socket into sender/receiver halves
let (mut ws_tx, mut ws_rx) = socket.split();
```

With:

```rust
tracing::info!(uuid = %uuid, "plugin registered via WS");

// Fire startup lifecycle events (lock order: PluginHost → profile_state)
{
    let host = state.plugin_host.lock().await;
    let ps = host.profile_state.lock().await;
    let cols = ps.grid.cols;
    let rows = ps.grid.rows;

    // deviceDidConnect must precede willAppear (Elgato ordering)
    let _ = tx.try_send(crate::events::outbound::device_did_connect(cols, rows));

    for (idx, btn) in ps.buttons.iter().enumerate() {
        if host.registry.get(&btn.action_uuid).map(|u| u == &uuid).unwrap_or(false) {
            let msg = crate::events::outbound::will_appear(
                &btn.action_uuid, &btn.context, &btn.settings, idx, cols,
            );
            let _ = tx.try_send(msg);
        }
    }
}

// Split the socket into sender/receiver halves
let (mut ws_tx, mut ws_rx) = socket.split();
```

- [ ] **Step 4: Run all tests**

```bash
cd packages/desktop/src-tauri && cargo test
```

Expected: all tests pass including the new `extract_token` test.

- [ ] **Step 5: Commit**

```bash
git add src/plugin/ws.rs
git commit -m "feat: fire deviceDidConnect + willAppear after plugin WS registration"
```

---

### Task 6: /api/plugins routes

**Files:** `src/server/routes.rs`

- [ ] **Step 1: Write failing tests**

Add to `src/server/routes.rs` tests:

```rust
#[tokio::test]
async fn get_plugins_returns_empty_list() {
    let state = make_state("tok");
    let app = create_router(state);
    let req = Request::builder()
        .method("GET")
        .uri("/api/plugins")
        .extension(axum::extract::ConnectInfo(local_addr()))
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), 200);
    let body = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json["plugins"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn plugin_status_unknown_uuid_returns_404() {
    let state = make_state("tok");
    let app = create_router(state);
    let req = Request::builder()
        .method("GET")
        .uri("/api/plugins/com.nobody.plugin/status")
        .extension(axum::extract::ConnectInfo(local_addr()))
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), 404);
}

#[tokio::test]
async fn install_plugin_returns_501() {
    let state = make_state("tok");
    let app = create_router(state.clone());
    let req = Request::builder()
        .method("POST")
        .uri("/api/plugins/install")
        .header("X-Panna-CSRF", "tok")
        .header("Content-Type", "application/json")
        .extension(axum::extract::ConnectInfo(local_addr()))
        .body(Body::from(r#"{"source":"npm","name":"my-plugin"}"#))
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), 501);
}
```

- [ ] **Step 2: Run failing tests**

```bash
cd packages/desktop/src-tauri && cargo test routes::tests::get_plugins routes::tests::plugin_status_unknown routes::tests::install_plugin
```

Expected: compile error (routes not defined).

- [ ] **Step 3: Add plugin routes to routes.rs**

Add these handler functions in `src/server/routes.rs` (before the `#[cfg(test)]` block):

```rust
async fn list_plugins_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let host = state.plugin_host.lock().await;
    let plugins: Vec<serde_json::Value> = host.manifests.iter().map(|(uuid, manifest)| {
        let status = host.plugins.get(uuid)
            .map(|ps| match &ps.status {
                crate::plugin::PluginStatus::Running  => "running",
                crate::plugin::PluginStatus::Starting => "starting",
                crate::plugin::PluginStatus::Stopped  => "stopped",
                crate::plugin::PluginStatus::Errored(_) => "errored",
            })
            .unwrap_or("not_spawned");
        serde_json::json!({
            "uuid": uuid,
            "name": manifest.name,
            "version": manifest.version,
            "author": manifest.author,
            "description": manifest.description,
            "status": status,
            "actions": manifest.actions.iter().map(|a| serde_json::json!({
                "uuid": a.uuid,
                "name": a.name,
            })).collect::<Vec<_>>(),
        })
    }).collect();
    Json(serde_json::json!({ "plugins": plugins }))
}

async fn plugin_status_handler(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> impl IntoResponse {
    let has_csrf = is_localhost_addr(&addr) && headers
        .get("X-Panna-CSRF")
        .and_then(|v| v.to_str().ok())
        .map(|t| csrf_eq(t, &state.csrf_token))
        .unwrap_or(false);

    let host = state.plugin_host.lock().await;
    if !host.manifests.contains_key(&uuid) {
        return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "plugin not found"}))).into_response();
    }

    let ps = host.plugins.get(&uuid);
    let status_str = ps.map(|p| match &p.status {
        crate::plugin::PluginStatus::Running    => "running".to_string(),
        crate::plugin::PluginStatus::Starting   => "starting".to_string(),
        crate::plugin::PluginStatus::Stopped    => "stopped".to_string(),
        crate::plugin::PluginStatus::Errored(e) => format!("errored: {e}"),
    }).unwrap_or_else(|| "not_spawned".to_string());

    let mut response = serde_json::json!({
        "uuid": &uuid,
        "status": status_str,
        "crashCount": ps.map(|p| p.crash_count).unwrap_or(0),
        "unsupportedEvents": ps.map(|p| {
            let mut v: Vec<String> = p.unsupported_events.iter().cloned().collect();
            v.sort();
            v
        }).unwrap_or_default(),
        "settingsNotPersisted": ps.map(|p| p.settings_not_persisted).unwrap_or(false),
    });

    if has_csrf {
        response["logTail"] = serde_json::json!(null); // full log tail in Plan 3
    }

    Json(response).into_response()
}

async fn install_plugin_handler() -> impl IntoResponse {
    (StatusCode::NOT_IMPLEMENTED, Json(serde_json::json!({"error": "plugin install not yet implemented"})))
}

async fn uninstall_plugin_handler(Path(_uuid): Path<String>) -> impl IntoResponse {
    (StatusCode::NOT_IMPLEMENTED, Json(serde_json::json!({"error": "plugin uninstall not yet implemented"})))
}
```

- [ ] **Step 4: Add routes to create_router**

In `create_router`, add to the public Router:

```rust
.route("/api/plugins", get(list_plugins_handler))
.route("/api/plugins/:uuid/status", get(plugin_status_handler))
```

And add to the admin Router (after `.route("/api/config", put(put_config))`):

```rust
.route("/api/plugins/install", post(install_plugin_handler))
.route("/api/plugins/:uuid", axum::routing::delete(uninstall_plugin_handler))
```

- [ ] **Step 5: Run all tests**

```bash
cd packages/desktop/src-tauri && cargo test
```

Expected: all tests pass including 3 new plugin route tests.

- [ ] **Step 6: Commit**

```bash
git add src/server/routes.rs
git commit -m "feat: add /api/plugins list + status routes, stub install/uninstall"
```

---

## Spec Coverage

| Requirement | Task |
|---|---|
| Manifest struct + Elgato manifest.json parsing | 1 |
| UUID missing/empty → hard block | 1 |
| CodePath missing, non-.js, absolute, or `..` → hard block | 1 |
| Empty Actions → hard block | 1 |
| Duplicate Action UUIDs → hard block | 1 |
| SDKVersion > 2 → hard block | 1 |
| OS mismatch → hard block | 1 |
| Scan `*.sdPlugin/` one level deep | 2 |
| Alphabetical dedup within same source | 2 |
| Invalid manifest silently skipped with warning | 2 |
| `resolve_node_binary`: bundled then system, version ≥ 20 | 3 |
| `node-runtime-needed` Tauri event when no Node.js found | 4 |
| Manifests + action→plugin registry populated at startup | 4 |
| Plugins spawned after WS endpoint is live | 4 |
| `deviceDidConnect` sent on plugin registration | 5 |
| `willAppear` per button sent after deviceDidConnect | 5 |
| Lock order: PluginHost → profile_state for lifecycle events | 5 |
| `GET /api/plugins` list (LAN OK) | 6 |
| `GET /api/plugins/:uuid/status` (logTail gated by CSRF) | 6 |
| `POST /api/plugins/install` stub (localhost + CSRF, 501) | 6 |
| `DELETE /api/plugins/:uuid` stub (localhost + CSRF, 501) | 6 |

**Out of scope for this plan (Plan 3+):**
- Profile switch lifecycle (willDisappear + spawn diff + willAppear for arriving)
- `/pi/*` property inspector iframe route + PI token
- `registerPropertyInspector` full implementation
- Plugin install via npm (Plan 3)
- Log file writing + logTail in status (Plan 3)
- Built-in plugins (Plan 3)
- `execute_command` Rust fallback removal (Plan 3)
