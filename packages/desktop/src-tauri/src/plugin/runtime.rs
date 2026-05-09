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
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        Command::new(path).arg("--version").output(),
    ).await;
    match result {
        Ok(Ok(o)) if o.status.success() => {
            let ver = String::from_utf8_lossy(&o.stdout);
            let major: u32 = ver.trim()
                .trim_start_matches('v')
                .split('.')
                .next()
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            major >= 20
        }
        Ok(Ok(_)) => false,
        Ok(Err(_)) => false,
        Err(_elapsed) => {
            tracing::warn!(path=%path.display(), "node --version timed out after 5s");
            false
        }
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
