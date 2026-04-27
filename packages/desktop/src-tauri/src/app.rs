use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Wry, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

pub struct AppState {
    pub port: Option<u16>,
    pub running: bool,
    pub menu: Option<Menu<Wry>>,
    pub child: Option<CommandChild>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            port: None,
            running: false,
            menu: None,
            child: None,
        }
    }
}

fn port_file_path() -> std::path::PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    std::path::PathBuf::from(home).join(".panna-cotta.port")
}

fn read_port() -> Option<u16> {
    std::fs::read_to_string(port_file_path())
        .ok()
        .and_then(|s| s.trim().parse::<u16>().ok())
}

pub fn spawn_sidecar(app: &AppHandle, state: &Arc<Mutex<AppState>>) {
    let shell = app.shell();
    match shell.sidecar("stream-backend") {
        Ok(cmd) => match cmd.spawn() {
            Ok((_rx, child)) => {
                let mut s = state.lock().unwrap_or_else(|e| e.into_inner());
                s.child = Some(child);
                s.running = true;
            }
            Err(e) => eprintln!("Failed to spawn sidecar: {e}"),
        },
        Err(e) => eprintln!("Failed to create sidecar command: {e}"),
    }
}

fn poll_port_with_retry(app: AppHandle, state: Arc<Mutex<AppState>>) {
    std::thread::spawn(move || {
        let mut retries = 0;
        loop {
            let port = read_port();
            let mut s = state.lock().unwrap_or_else(|e| e.into_inner());
            match port {
                Some(p) => {
                    retries = 0;
                    s.port = Some(p);
                    s.running = true;
                    let menu = s.menu.clone();
                    drop(s);
                    update_tray_status(&app, &menu, Some(p), true);
                }
                None => {
                    retries += 1;
                    if retries >= 3 {
                        s.running = false;
                        let menu = s.menu.clone();
                        drop(s);
                        update_tray_status(&app, &menu, None, false);
                    } else {
                        drop(s);
                    }
                }
            }
            std::thread::sleep(Duration::from_millis(500));
        }
    });
}

fn update_tray_status(app: &AppHandle, menu: &Option<Menu<Wry>>, port: Option<u16>, running: bool) {
    let Some(menu) = menu else { return };

    let port_text = match port {
        Some(p) => format!("Port: {p}"),
        None => "Port: --".to_string(),
    };
    let status_text = if running { "● Running" } else { "○ Stopped" };
    let btn_text = if running { "Stop" } else { "Start" };

    if let Some(item) = menu.get("port") {
        if let Some(m) = item.as_menuitem() {
            let _ = m.set_text(&port_text);
        }
    }
    if let Some(item) = menu.get("status") {
        if let Some(m) = item.as_menuitem() {
            let _ = m.set_text(status_text);
        }
    }
    if let Some(item) = menu.get("start-stop") {
        if let Some(m) = item.as_menuitem() {
            let _ = m.set_text(btn_text);
        }
    }
    // Update tray icon tooltip or title if needed
    if let Some(tray) = app.tray_by_id("main") {
        let tooltip = format!("Panna Cotta — {}", if running { port_text.as_str() } else { "Stopped" });
        let _ = tray.set_tooltip(Some(&tooltip));
    }
}

pub fn toggle_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let port = read_port().unwrap_or(30000);
            if let Ok(url) = format!("http://localhost:{port}/apps/").parse() {
                let _ = window.navigate(url);
            }
            let _ = window.show();
            let _ = window.set_focus();
        }
    } else {
        open_window(app);
    }
}

fn open_admin(app: &AppHandle) {
    let port = read_port().unwrap_or(30000);
    let url = format!("http://localhost:{port}/admin");
    if let Ok(parsed) = url.parse() {
        if let Some(win) = app.get_webview_window("admin") {
            let _ = win.navigate(parsed);
            let _ = win.show();
            let _ = win.set_focus();
        } else if let Ok(win) = WebviewWindowBuilder::new(app, "admin", WebviewUrl::External(parsed))
            .title("Panna Cotta — Admin")
            .inner_size(540.0, 720.0)
            .decorations(true)
            .build()
        {
            let _ = win.show();
        }
    }
}

fn open_window(app: &AppHandle) {
    let port = read_port().unwrap_or(30000);
    let url = format!("http://localhost:{port}");
    if let Ok(parsed) = url.parse() {
        let _ = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(parsed))
            .title("Panna Cotta")
            .inner_size(420.0, 680.0)
            .decorations(false)
            .skip_taskbar(true)
            .build();
    }
}

fn build_tray(app: &AppHandle, state: Arc<Mutex<AppState>>) -> tauri::Result<()> {
    use tauri_plugin_autostart::ManagerExt;
    let is_autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);

    let open = MenuItemBuilder::new("Open").id("open").build(app)?;
    let admin = MenuItemBuilder::new("Admin Config…").id("admin").build(app)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let port_item = MenuItemBuilder::new("Port: --")
        .id("port")
        .enabled(false)
        .build(app)?;
    let status_item = MenuItemBuilder::new("○ Stopped")
        .id("status")
        .enabled(false)
        .build(app)?;
    let start_stop = MenuItemBuilder::new("Start").id("start-stop").build(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let autostart = CheckMenuItem::with_id(
        app,
        "autostart",
        "Launch at Login",
        true,
        is_autostart_enabled,
        None::<&str>,
    )?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::new("Quit").id("quit").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&open)
        .item(&admin)
        .item(&sep1)
        .item(&port_item)
        .item(&status_item)
        .item(&start_stop)
        .item(&sep2)
        .item(&autostart)
        .item(&sep3)
        .item(&quit)
        .build()?;

    // Store menu in state for later updates
    state.lock().unwrap_or_else(|e| e.into_inner()).menu = Some(menu.clone());

    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))
        .map_err(|e| tauri::Error::InvalidIcon(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .icon_as_template(true)
        .menu(&menu)
        .on_menu_event(|app, event| handle_menu_event(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                toggle_window(app);
            }
        })
        .build(app)?;

    Ok(())
}

fn handle_menu_event(app: &AppHandle, id: &str) {
    match id {
        "open" => toggle_window(app),
        "admin" => open_admin(app),
        "quit" => {
            let state = app.state::<Arc<Mutex<AppState>>>();
            if let Some(child) = state.lock().unwrap_or_else(|e| e.into_inner()).child.take() {
                let _ = child.kill();
            }
            app.exit(0);
        }
        "start-stop" => {
            let state = app.state::<Arc<Mutex<AppState>>>();
            let mut s = state.lock().unwrap_or_else(|e| e.into_inner());
            if s.running {
                if let Some(child) = s.child.take() {
                    let _ = child.kill();
                    s.running = false;
                    let menu = s.menu.clone();
                    drop(s);
                    update_tray_status(app, &menu, None, false);
                }
            } else {
                drop(s);
                spawn_sidecar(app, &app.state::<Arc<Mutex<AppState>>>());
            }
        }
        "autostart" => {
            use tauri_plugin_autostart::ManagerExt;
            let autolaunch = app.autolaunch();
            let enabled = autolaunch.is_enabled().unwrap_or(false);
            if enabled {
                let _ = autolaunch.disable();
            } else {
                let _ = autolaunch.enable();
            }
        }
        _ => {}
    }
}

pub fn run() {
    let state: Arc<Mutex<AppState>> = Arc::new(Mutex::new(AppState::default()));
    let state_for_setup = Arc::clone(&state);

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_shell::init())
        .manage(state)
        .setup(move |app| {
            let state_for_tray = Arc::clone(&state_for_setup);
            let state_for_poll = Arc::clone(&state_for_setup);

            spawn_sidecar(app.handle(), &state_for_setup);
            build_tray(app.handle(), state_for_tray)?;
            poll_port_with_retry(app.handle().clone(), state_for_poll);

            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

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
