use std::process::Command;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use url::Url;

pub fn validate_url_scheme(url: &str) -> Result<(), String> {
    let parsed = Url::parse(url).map_err(|_| format!("invalid URL: {url}"))?;
    match parsed.scheme() {
        "https" | "http" => Ok(()),
        s => Err(format!("URL scheme '{s}' not allowed; only https and http are accepted")),
    }
}

#[tauri::command]
pub async fn execute_command(action: String, target: String) -> Result<(), String> {
    let output = match action.as_str() {
        "open-app" => Command::new("open").args(["-a", &target]).output(),
        "system-volume" => Command::new("osascript")
            .args(["-e", &format!("set volume output volume {target}")])
            .output(),
        "brightness" => Command::new("brightness").arg(&target).output(),
        "volume-up" => Command::new("osascript")
            .args([
                "-e",
                "set volume output volume ((output volume of (get volume settings)) + 10)",
            ])
            .output(),
        "volume-down" => Command::new("osascript")
            .args([
                "-e",
                "set volume output volume ((output volume of (get volume settings)) - 10)",
            ])
            .output(),
        "volume-mute" => Command::new("osascript")
            .args([
                "-e",
                "set volume output muted (not (output muted of (get volume settings)))",
            ])
            .output(),
        "brightness-up" => Command::new("brightness").arg("0.1").output(),
        "brightness-down" => Command::new("brightness").arg("-0.1").output(),
        "sleep" => Command::new("pmset").args(["sleepnow"]).output(),
        "lock" => Command::new("osascript")
            .args([
                "-e",
                "tell application \"System Events\" to keystroke \"q\" using {command down, control down}",
            ])
            .output(),
        _ => return Err(format!("Unknown action: {action}")),
    };
    let result = output.map(|_| ()).map_err(|e| e.to_string());
    match &result {
        Ok(()) => tracing::info!(action = %action, target = %target, "execute ok"),
        Err(e) => tracing::warn!(action = %action, target = %target, error = %e, "execute failed"),
    }
    result
}

#[tauri::command]
pub async fn open_app(app_name: String) -> Result<(), String> {
    let result = Command::new("open")
        .args(["-a", &app_name])
        .output()
        .map(|_| ())
        .map_err(|e| e.to_string());
    match &result {
        Ok(()) => tracing::info!(app = %app_name, "open-app ok"),
        Err(e) => tracing::warn!(app = %app_name, error = %e, "open-app failed"),
    }
    result
}

#[tauri::command]
pub async fn open_url(url: String) -> Result<(), String> {
    validate_url_scheme(&url)?;
    let result = Command::new("open")
        .arg(&url)
        .output()
        .map(|_| ())
        .map_err(|e| e.to_string());
    match &result {
        Ok(()) => tracing::info!(url = %url, "open-url ok"),
        Err(e) => tracing::warn!(url = %url, error = %e, "open-url failed"),
    }
    result
}

#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub async fn quit_app(app: AppHandle) {
    tracing::info!("app quit");
    let state = app.state::<Arc<crate::server::state::AppState>>();
    let cols = {
        let host = state.plugin_host.lock().await;
        let ps = host.profile_state.lock().await;
        ps.grid.cols
    };
    {
        let mut host = state.plugin_host.lock().await;
        host.shutdown(cols).await;
    }
    app.exit(0);
}

#[tauri::command]
pub async fn get_autostart(app: AppHandle) -> bool {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
pub async fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let al = app.autolaunch();
    if enabled { al.enable() } else { al.disable() }.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn open_url_rejects_file_scheme() {
        assert!(super::validate_url_scheme("file:///etc/passwd").is_err());
        assert!(super::validate_url_scheme("javascript:alert(1)").is_err());
        assert!(super::validate_url_scheme("ftp://example.com").is_err());
    }

    #[test]
    fn open_url_accepts_http_https() {
        assert!(super::validate_url_scheme("https://example.com").is_ok());
        assert!(super::validate_url_scheme("http://localhost:3000").is_ok());
    }
}
