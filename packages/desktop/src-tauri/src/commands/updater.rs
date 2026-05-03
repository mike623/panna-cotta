use std::sync::atomic::{AtomicBool, Ordering};
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_updater::UpdaterExt;

static IS_CHECKING: AtomicBool = AtomicBool::new(false);

struct CheckGuard;
impl Drop for CheckGuard {
    fn drop(&mut self) {
        IS_CHECKING.store(false, Ordering::Release);
    }
}

pub async fn run_update_check(app: AppHandle, manual: bool) {
    if IS_CHECKING.swap(true, Ordering::AcqRel) {
        return;
    }
    let _guard = CheckGuard;
    do_check(&app, manual).await;
}

async fn do_check(app: &AppHandle, manual: bool) {
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            eprintln!("Updater init error: {e}");
            return;
        }
    };

    match updater.check().await {
        Ok(Some(update)) => {
            if let Err(e) = update.download_and_install(|_, _| {}, || {}).await {
                eprintln!("Update install failed: {e}");
                return;
            }
            let restart = app
                .dialog()
                .message("A new version has been installed. Restart now?")
                .title("Update Ready")
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "Restart Now".to_string(),
                    "Later".to_string(),
                ))
                .blocking_show();
            if restart {
                app.request_restart();
            }
        }
        Ok(None) => {
            if manual {
                let version = app.package_info().version.to_string();
                app.dialog()
                    .message(format!("You're up to date (v{version})"))
                    .title("No Updates Available")
                    .blocking_show();
            }
        }
        Err(e) => {
            eprintln!("Update check failed: {e}");
        }
    }
}

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) {
    run_update_check(app, true).await;
}
