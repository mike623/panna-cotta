use std::sync::{Arc, Mutex};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, Wry,
};
use tauri_plugin_autostart::MacosLauncher;
use crate::server::state::AppState;

pub struct TrayState {
    pub menu: Option<Menu<Wry>>,
}

fn update_tray_status(app: &AppHandle, menu: &Option<Menu<Wry>>, port: Option<u16>, running: bool) {
    let Some(menu) = menu else { return };
    let port_text = port.map_or("Port: --".to_string(), |p| format!("Port: {p}"));
    let status_text = if running { "● Running" } else { "○ Stopped" };
    if let Some(item) = menu.get("port") {
        if let Some(m) = item.as_menuitem() { let _ = m.set_text(&port_text); }
    }
    if let Some(item) = menu.get("status") {
        if let Some(m) = item.as_menuitem() { let _ = m.set_text(status_text); }
    }
    if let Some(tray) = app.tray_by_id("main") {
        let tooltip = format!("Panna Cotta — {}", if running { &port_text } else { "Stopped" });
        let _ = tray.set_tooltip(Some(&tooltip));
    }
}

pub fn toggle_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.show();
            let _ = w.set_focus();
        }
    } else {
        open_main_window(app);
    }
}

fn open_main_window(app: &AppHandle) {
    let port = app
        .state::<Arc<AppState>>()
        .port.lock().ok()
        .and_then(|p| *p)
        .unwrap_or(30000);
    if let Ok(url) = format!("http://localhost:{port}/apps/").parse() {
        let _ = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
            .title("Panna Cotta")
            .inner_size(420.0, 680.0)
            .decorations(false)
            .skip_taskbar(true)
            .build();
    }
}

fn open_admin(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("admin") {
        let _ = w.show();
        let _ = w.set_focus();
    } else {
        let _ = WebviewWindowBuilder::new(
            app,
            "admin",
            WebviewUrl::App(std::path::PathBuf::from("index.html")),
        )
        .title("Panna Cotta — Admin")
        .inner_size(760.0, 600.0)
        .decorations(true)
        .build();
    }
}

fn open_qr_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("qr") {
        let _ = w.show();
        let _ = w.set_focus();
    } else {
        let _ = WebviewWindowBuilder::new(
            app,
            "qr",
            WebviewUrl::App(std::path::PathBuf::from("qr.html")),
        )
        .title("Panna Cotta — QR Code")
        .inner_size(320.0, 420.0)
        .resizable(false)
        .decorations(true)
        .build();
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri_plugin_autostart::ManagerExt;
    let is_autostart = app.autolaunch().is_enabled().unwrap_or(false);

    let open = MenuItemBuilder::new("Open").id("open").build(app)?;
    let admin = MenuItemBuilder::new("Admin Config…").id("admin").build(app)?;
    let qr = MenuItemBuilder::new("Show QR Code").id("qr").build(app)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let port_item = MenuItemBuilder::new("Port: --").id("port").enabled(false).build(app)?;
    let status_item = MenuItemBuilder::new("○ Starting…").id("status").enabled(false).build(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let autostart = CheckMenuItem::with_id(app, "autostart", "Launch at Login", true, is_autostart, None::<&str>)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let version_str = format!("v{}", app.package_info().version);
    let version_item = MenuItemBuilder::new(version_str).id("version").enabled(false).build(app)?;
    let quit = MenuItemBuilder::new("Quit").id("quit").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&open).item(&admin).item(&qr).item(&sep1)
        .item(&port_item).item(&status_item).item(&sep2)
        .item(&autostart).item(&sep3).item(&version_item).item(&quit)
        .build()?;

    app.state::<Mutex<TrayState>>()
        .lock().unwrap().menu = Some(menu.clone());

    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))
        .map_err(|e| tauri::Error::InvalidIcon(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .icon_as_template(true)
        .menu(&menu)
        .on_menu_event(|app, event| handle_menu_event(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                toggle_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

fn handle_menu_event(app: &AppHandle, id: &str) {
    match id {
        "open" => toggle_window(app),
        "admin" => open_admin(app),
        "qr" => open_qr_window(app),
        "autostart" => {
            use tauri_plugin_autostart::ManagerExt;
            let al = app.autolaunch();
            if al.is_enabled().unwrap_or(false) { let _ = al.disable(); } else { let _ = al.enable(); }
        }
        "quit" => app.exit(0),
        _ => {}
    }
}

pub fn run() {
    let app_state = Arc::new(AppState::new());
    let tray_state = Mutex::new(TrayState { menu: None });

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![])))
        .manage(app_state.clone())
        .manage(tray_state)
        .invoke_handler(tauri::generate_handler![
            crate::commands::config::get_config,
            crate::commands::config::save_config,
            crate::commands::config::get_default_config,
            crate::commands::config::list_profiles_cmd,
            crate::commands::config::create_profile_cmd,
            crate::commands::config::activate_profile_cmd,
            crate::commands::config::rename_profile_cmd,
            crate::commands::config::delete_profile_cmd,
            crate::commands::config::open_config_folder,
            crate::commands::system::execute_command,
            crate::commands::system::open_app,
            crate::commands::system::open_url,
            crate::commands::version::get_version_info,
            crate::commands::server_info::get_server_info,
        ])
        .setup(move |app| {
            build_tray(app.handle())?;

            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let app_handle = app.handle().clone();
            let state = app_state.clone();

            tauri::async_runtime::spawn(async move {
                match crate::server::start(state.clone()).await {
                    Ok(port) => {
                        let tray_state = app_handle.state::<Mutex<TrayState>>();
                        let menu = tray_state.lock().unwrap().menu.clone();
                        update_tray_status(&app_handle, &menu, Some(port), true);
                    }
                    Err(e) => eprintln!("Server failed to start: {e}"),
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error running Tauri app");
}
