use std::process::Command;
use tauri::AppHandle;

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
    output.map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_app(app_name: String) -> Result<(), String> {
    Command::new("open")
        .args(["-a", &app_name])
        .output()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_url(url: String) -> Result<(), String> {
    Command::new("open")
        .arg(&url)
        .output()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn quit_app(app: AppHandle) {
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
