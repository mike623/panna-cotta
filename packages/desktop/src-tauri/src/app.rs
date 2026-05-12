use std::sync::Arc;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, Wry,
};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_deep_link::DeepLinkExt;
use crate::server::state::AppState;
use tracing_appender::rolling;
use tracing_subscriber::{fmt, EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};

fn update_tray_tooltip(app: &AppHandle, port: Option<u16>, running: bool) {
    if let Some(tray) = app.tray_by_id("main") {
        let tooltip = if running {
            port.map_or("Panna Cotta — Running".into(), |p| format!("Panna Cotta — Port {p}"))
        } else {
            "Panna Cotta — Stopped".into()
        };
        let _ = tray.set_tooltip(Some(&tooltip));
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
        .inner_size(1440.0, 786.0)
        .resizable(false)
        .decorations(true)
        .build();
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))
        .map_err(|e| tauri::Error::InvalidIcon(std::io::Error::other(e.to_string())))?;

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .icon_as_template(true)
        .tooltip("Panna Cotta")
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                open_admin(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

fn build_app_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<Wry>> {
    let check_updates = MenuItemBuilder::new("Check for Updates\u{2026}")
        .id("check-for-updates")
        .build(app)?;
    let app_submenu = SubmenuBuilder::new(app, "Panna Cotta")
        .item(&check_updates)
        .build()?;

    // Standard Edit submenu — required on macOS for WKWebView to receive
    // Cmd+C/V/X/A/Z/Shift+Z via the OS responder chain.
    let edit_submenu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;

    MenuBuilder::new(app).item(&app_submenu).item(&edit_submenu).build()
}

pub fn run() {
    // ── Logging init ─────────────────────────────────────────────────────────
    let log_dir = crate::server::state::resolve_config_dir().join("logs");
    std::fs::create_dir_all(&log_dir).ok();

    let file_appender = rolling::daily(&log_dir, "panna-cotta.log");
    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info"));

    tracing_subscriber::registry()
        .with(filter)
        .with(fmt::layer().with_writer(non_blocking).with_ansi(false))
        .init();

    tracing::info!(version = env!("CARGO_PKG_VERSION"), "app starting");

    let app_state = Arc::new(AppState::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![])))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(app_state.clone())
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
            crate::commands::config::get_csrf_token,
            crate::commands::config::open_log_folder,
            crate::commands::plugins::list_plugins_cmd,
            crate::commands::plugins::get_plugin_render,
            crate::commands::system::list_installed_apps,
            crate::commands::system::open_app,
            crate::commands::system::open_url,
            crate::commands::system::quit_app,
            crate::commands::system::get_app_version,
            crate::commands::system::get_autostart,
            crate::commands::system::set_autostart,
            crate::commands::updater::check_for_updates,
            crate::commands::server_info::get_server_info,
        ])
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "check-for-updates" {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    crate::commands::updater::run_update_check(app, true).await;
                });
            }
        })
        .setup(move |app| {
            build_tray(app.handle())?;

            let app_menu = build_app_menu(app.handle())?;
            app.set_menu(app_menu)?;

            let update_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                crate::commands::updater::run_update_check(update_handle.clone(), false).await;
                let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(3600));
                interval.tick().await;
                loop {
                    interval.tick().await;
                    crate::commands::updater::run_update_check(update_handle.clone(), false).await;
                }
            });

            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let app_handle = app.handle().clone();
            let state = app_state.clone();

            // Store AppHandle so inbound events can fire Tauri events
            *state.app_handle.lock().unwrap() = Some(app.handle().clone());

            // Deep-link: intercept streamdeck://plugins/install?url=...
            {
                let state_dl = app_state.clone();
                let handle_dl = app.handle().clone();
                app.deep_link().on_open_url(move |url_event| {
                    for url in url_event.urls() {
                        let url_str = url.to_string();
                        let s = state_dl.clone();
                        let h = handle_dl.clone();
                        tauri::async_runtime::spawn(async move {
                            crate::commands::plugin_install::handle_deep_link(&url_str, &s, &h).await;
                        });
                    }
                });
            }

            tauri::async_runtime::spawn(async move {
                match crate::server::start(state.clone()).await {
                    Ok(port) => {
                        update_tray_tooltip(&app_handle, Some(port), true);
                        // Copy built-in plugins from Tauri resources to ~/.panna-cotta/plugins/
                        if let Ok(resource_dir) = app_handle.path().resource_dir() {
                            let resource_plugins = resource_dir.join("plugins");
                            let dest_plugins = state.config_dir.join("plugins");
                            if resource_plugins.exists() {
                                if let Err(e) = crate::server::copy_builtin_plugins(&resource_plugins, &dest_plugins).await {
                                    tracing::warn!(error = %e, "copy built-in plugins failed");
                                }
                            }
                        }
                        crate::server::post_start_spawn(state, &app_handle).await;
                    }
                    Err(e) => {
                        tracing::error!(error = %e, "server failed to start");
                        update_tray_tooltip(&app_handle, None, false);
                    }
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
