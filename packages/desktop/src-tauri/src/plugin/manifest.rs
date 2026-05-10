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
    #[serde(rename = "PropertyInspectorPath", default)]
    pub property_inspector_path: Option<String>,
}

pub fn validate(manifest: &Manifest, plugin_dir: &Path) -> Result<(), String> {
    validate_with_platform(manifest, plugin_dir, current_platform())
}

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
        if let Some(pi_path) = &action.property_inspector_path {
            let pi = Path::new(pi_path);
            if pi.is_absolute() {
                return Err(format!(
                    "PropertyInspectorPath in action '{}' must be relative",
                    action.uuid
                ));
            }
            if pi.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
                return Err(format!(
                    "PropertyInspectorPath in action '{}' contains '..' and could escape plugin directory",
                    action.uuid
                ));
            }
        }
    }
    if manifest.sdk_version > 6 {
        return Err(format!("SDKVersion {} > 6 is not supported", manifest.sdk_version));
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
    if cfg!(target_os = "macos") {
        "mac"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
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
            actions: vec![Action {
                uuid: "com.example.plugin.action".into(),
                name: "A".into(),
                property_inspector_path: None,
            }],
        }
    }

    #[test]
    fn valid_manifest_passes() {
        assert!(validate_with_platform(&valid(), Path::new("/tmp"), "mac").is_ok());
    }

    #[test]
    fn missing_uuid_fails() {
        let mut m = valid();
        m.uuid = "".into();
        assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_err());
    }

    #[test]
    fn missing_code_path_fails() {
        let mut m = valid();
        m.code_path = "".into();
        assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_err());
    }

    #[test]
    fn non_js_code_path_fails() {
        let mut m = valid();
        m.code_path = "bin/plugin.ts".into();
        assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_err());
    }

    #[test]
    fn dotdot_code_path_fails() {
        let mut m = valid();
        m.code_path = "../evil.js".into();
        assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_err());
    }

    #[test]
    fn absolute_code_path_fails() {
        let mut m = valid();
        m.code_path = "/etc/evil.js".into();
        assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_err());
    }

    #[test]
    fn empty_actions_fails() {
        let mut m = valid();
        m.actions = vec![];
        assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_err());
    }

    #[test]
    fn duplicate_action_uuids_fail() {
        let mut m = valid();
        m.actions = vec![
            Action {
                uuid: "com.dup".into(),
                name: "A".into(),
                property_inspector_path: None,
            },
            Action {
                uuid: "com.dup".into(),
                name: "B".into(),
                property_inspector_path: None,
            },
        ];
        assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_err());
    }

    #[test]
    fn sdk_version_too_high_fails() {
        let mut m = valid();
        m.sdk_version = 7;
        assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_err());
    }

    #[test]
    fn sdk_version_6_passes() {
        let mut m = valid();
        m.sdk_version = 6;
        assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_ok());
    }

    #[test]
    fn sdk_version_7_fails() {
        let mut m = valid();
        m.sdk_version = 7;
        assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_err());
    }

    #[test]
    fn os_mismatch_fails() {
        let mut m = valid();
        m.os = vec![OsEntry {
            platform: "windows".into(),
        }];
        assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_err());
    }

    #[test]
    fn os_match_passes() {
        let mut m = valid();
        m.os = vec![
            OsEntry {
                platform: "mac".into(),
            },
            OsEntry {
                platform: "windows".into(),
            },
        ];
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

    #[test]
    fn parse_action_with_pi_path() {
        let json = r#"{
            "UUID": "com.example.plugin",
            "Name": "Example",
            "SDKVersion": 2,
            "CodePath": "bin/plugin.js",
            "Actions": [{
                "UUID": "com.example.plugin.act",
                "Name": "Act",
                "PropertyInspectorPath": "pi/index.html"
            }]
        }"#;
        let m: Manifest = serde_json::from_str(json).unwrap();
        assert_eq!(m.actions[0].property_inspector_path.as_deref(), Some("pi/index.html"));
    }

    #[test]
    fn dotdot_pi_path_fails() {
        let mut m = valid();
        m.actions[0].property_inspector_path = Some("../evil/pi.html".into());
        assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_err());
    }

    #[test]
    fn absolute_pi_path_fails() {
        let mut m = valid();
        m.actions[0].property_inspector_path = Some("/etc/passwd".into());
        assert!(validate_with_platform(&m, Path::new("/tmp"), "mac").is_err());
    }

    #[test]
    fn parse_action_without_pi_path() {
        let json = r#"{
            "UUID": "com.example.plugin",
            "Name": "Example",
            "SDKVersion": 2,
            "CodePath": "bin/plugin.js",
            "Actions": [{"UUID": "com.example.plugin.act", "Name": "Act"}]
        }"#;
        let m: Manifest = serde_json::from_str(json).unwrap();
        assert!(m.actions[0].property_inspector_path.is_none());
    }
}
