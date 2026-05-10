use std::sync::Arc;
use crate::server::state::AppState;

const SUPPORTED: &[&str] = &[
    "registerPlugin", "registerPropertyInspector",
    "setTitle", "setSettings", "getSettings",
    "showOk", "showAlert", "openUrl", "logMessage",
    "sendToPropertyInspector", "sendToPlugin",
    "setImage", "setState", "setGlobalSettings", "getGlobalSettings",
];

pub fn is_unsupported(event: &str) -> bool {
    !SUPPORTED.contains(&event)
}

pub async fn dispatch(msg: serde_json::Value, plugin_uuid: &str, state: &Arc<AppState>) {
    let event = msg.get("event").and_then(|v| v.as_str()).unwrap_or("");
    match event {
        "setSettings"             => on_set_settings(msg, plugin_uuid, state).await,
        "getSettings"             => on_get_settings(msg, plugin_uuid, state).await,
        "setTitle"                => on_set_title(&msg, plugin_uuid, state),
        "showOk"                  => on_show_ok(&msg, plugin_uuid),
        "showAlert"               => on_show_alert(&msg, plugin_uuid),
        "openUrl"                 => on_open_url(msg, plugin_uuid).await,
        "logMessage"              => on_log_message(&msg, plugin_uuid),
        "sendToPropertyInspector" => on_send_to_pi(&msg, plugin_uuid, state),
        "setImage"                => on_set_image(&msg, plugin_uuid, state),
        "setState"                => on_set_state(&msg, plugin_uuid, state),
        "setGlobalSettings"       => on_set_global_settings(&msg, plugin_uuid, state).await,
        "getGlobalSettings"       => on_get_global_settings(plugin_uuid, state).await,
        _ if is_unsupported(event) => record_unsupported(plugin_uuid, event, state).await,
        _ => {}
    }
}

async fn on_set_settings(msg: serde_json::Value, plugin_uuid: &str, state: &Arc<AppState>) {
    let context = match msg.get("context").and_then(|v| v.as_str()) {
        Some(c) => c.to_string(),
        None => return,
    };
    let payload = msg.get("payload").cloned().unwrap_or(serde_json::Value::Null);

    // Lock order: PluginHost → profile_state
    let config_snapshot = {
        let host = state.plugin_host.lock().await;
        let mut ps = host.profile_state.lock().await;
        if let Some(btn) = ps.buttons.iter_mut().find(|b| b.context == context) {
            btn.settings = payload;
        } else {
            tracing::debug!(plugin=%plugin_uuid, ctx=%context, "setSettings: unknown context");
            return;
        }
        ps.clone()
    };

    // Persist outside lock
    let active = crate::server::state::get_active_profile_name(state).await;
    let path = crate::server::state::profile_json_path(state, &active);
    let tmp = path.with_extension("json.tmp");
    let json = match serde_json::to_string_pretty(&config_snapshot) {
        Ok(j) => j,
        Err(e) => {
            tracing::error!(plugin=%plugin_uuid, error=%e, "setSettings: serialize failed");
            mark_not_persisted(plugin_uuid, state).await;
            return;
        }
    };
    if let Err(e) = tokio::fs::create_dir_all(path.parent().unwrap()).await {
        tracing::error!(plugin=%plugin_uuid, error=%e, "setSettings: mkdir failed");
        mark_not_persisted(plugin_uuid, state).await;
        return;
    }
    if tokio::fs::write(&tmp, &json).await.is_err()
        || tokio::fs::rename(&tmp, &path).await.is_err()
    {
        tracing::error!(plugin=%plugin_uuid, "setSettings: disk write failed");
        mark_not_persisted(plugin_uuid, state).await;
        return;
    }
    tracing::info!(plugin=%plugin_uuid, ctx=%context, "setSettings persisted");
}

async fn on_get_settings(msg: serde_json::Value, plugin_uuid: &str, state: &Arc<AppState>) {
    let context = match msg.get("context").and_then(|v| v.as_str()) {
        Some(c) => c.to_string(),
        None => return,
    };
    let (action_uuid, settings) = {
        let host = state.plugin_host.lock().await;
        let ps = host.profile_state.lock().await;
        match ps.buttons.iter().find(|b| b.context == context) {
            Some(btn) => (btn.action_uuid.clone(), btn.settings.clone()),
            None => return,
        }
    };
    let response = crate::events::outbound::did_receive_settings(&action_uuid, &context, &settings);
    let host = state.plugin_host.lock().await;
    host.try_send(plugin_uuid, response);
}

fn emit_render_updated(state: &Arc<AppState>) {
    use tauri::Emitter;
    if let Ok(guard) = state.app_handle.lock() {
        if let Some(handle) = guard.as_ref() {
            let _ = handle.emit("plugin-render-updated", ());
        }
    }
}

fn on_set_image(msg: &serde_json::Value, plugin_uuid: &str, state: &Arc<AppState>) {
    let context = match msg.get("context").and_then(|v| v.as_str()) {
        Some(c) => c.to_string(),
        None => return,
    };
    let image = match msg["payload"]["image"].as_str() {
        Some(i) => i.to_string(),
        None => return,
    };
    if let Ok(mut render) = state.plugin_render.lock() {
        render.images.insert(context, image);
    }
    emit_render_updated(state);
    tracing::debug!(plugin=%plugin_uuid, "setImage stored");
}

fn on_set_title(msg: &serde_json::Value, plugin_uuid: &str, state: &Arc<AppState>) {
    let context = match msg.get("context").and_then(|v| v.as_str()) {
        Some(c) => c.to_string(),
        None => return,
    };
    let title = msg["payload"]["title"].as_str().unwrap_or("").to_string();
    if let Ok(mut render) = state.plugin_render.lock() {
        render.titles.insert(context, title);
    }
    emit_render_updated(state);
    tracing::debug!(plugin=%plugin_uuid, "setTitle stored");
}

fn on_set_state(msg: &serde_json::Value, plugin_uuid: &str, state: &Arc<AppState>) {
    let context = match msg.get("context").and_then(|v| v.as_str()) {
        Some(c) => c.to_string(),
        None => return,
    };
    let state_val = msg["payload"]["state"].as_u64().unwrap_or(0) as u32;
    if let Ok(mut render) = state.plugin_render.lock() {
        render.states.insert(context, state_val);
    }
    tracing::debug!(plugin=%plugin_uuid, "setState stored");
}

async fn on_set_global_settings(msg: &serde_json::Value, plugin_uuid: &str, state: &Arc<AppState>) {
    let payload = msg.get("payload").cloned().unwrap_or(serde_json::Value::Null);
    if let Err(e) = crate::commands::plugins::write_global_settings(&state.config_dir, plugin_uuid, &payload).await {
        tracing::error!(plugin=%plugin_uuid, error=%e, "setGlobalSettings: write failed");
    } else {
        tracing::info!(plugin=%plugin_uuid, "setGlobalSettings persisted");
    }
}

async fn on_get_global_settings(plugin_uuid: &str, state: &Arc<AppState>) {
    let settings = crate::commands::plugins::read_global_settings(&state.config_dir, plugin_uuid).await;
    let outbound_msg = crate::events::outbound::did_receive_global_settings(plugin_uuid, &settings);
    let host = state.plugin_host.lock().await;
    host.try_send(plugin_uuid, outbound_msg);
}

fn on_show_ok(msg: &serde_json::Value, plugin_uuid: &str) {
    let ctx = msg.get("context").and_then(|v| v.as_str()).unwrap_or("?");
    tracing::info!(plugin=%plugin_uuid, ctx=%ctx, "showOk");
}

fn on_show_alert(msg: &serde_json::Value, plugin_uuid: &str) {
    let ctx = msg.get("context").and_then(|v| v.as_str()).unwrap_or("?");
    tracing::warn!(plugin=%plugin_uuid, ctx=%ctx, "showAlert");
}

async fn on_open_url(msg: serde_json::Value, plugin_uuid: &str) {
    let url = match msg["payload"]["url"].as_str() {
        Some(u) => u.to_string(),
        None => return,
    };
    if let Err(e) = crate::commands::system::validate_url_scheme(&url) {
        tracing::warn!(plugin=%plugin_uuid, url=%url, error=%e, "openUrl rejected");
        return;
    }
    if let Err(e) = crate::commands::system::open_url(url.clone()).await {
        tracing::warn!(plugin=%plugin_uuid, url=%url, error=%e, "openUrl failed");
    }
}

fn on_log_message(msg: &serde_json::Value, plugin_uuid: &str) {
    let text = msg["payload"]["message"].as_str().unwrap_or("");
    tracing::info!(plugin=%plugin_uuid, "[plugin] {}", text);
}

fn on_send_to_pi(msg: &serde_json::Value, plugin_uuid: &str, state: &Arc<AppState>) {
    let context = msg.get("context").and_then(|v| v.as_str()).unwrap_or("");
    let action_uuid = msg.get("action").and_then(|v| v.as_str()).unwrap_or("");
    let payload = msg.get("payload").cloned().unwrap_or(serde_json::Value::Null);
    let fwd = crate::events::outbound::send_to_property_inspector(action_uuid, context, &payload);
    if let Ok(host) = state.plugin_host.try_lock() {
        if let Some(ps) = host.plugins.get(plugin_uuid) {
            if let Some(pi_tx) = &ps.pi_sender {
                let _ = pi_tx.try_send(fwd);
            }
        }
    }
}

async fn record_unsupported(plugin_uuid: &str, event: &str, state: &Arc<AppState>) {
    let mut host = state.plugin_host.lock().await;
    if let Some(ps) = host.plugins.get_mut(plugin_uuid) {
        let inserted = ps.unsupported_events.insert(event.to_string());
        if inserted {
            tracing::warn!(plugin=%plugin_uuid, event=%event, "unsupported plugin event");
        }
    }
}

async fn mark_not_persisted(plugin_uuid: &str, state: &Arc<AppState>) {
    let mut host = state.plugin_host.lock().await;
    if let Some(ps) = host.plugins.get_mut(plugin_uuid) {
        ps.settings_not_persisted = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::state::{AppState, Button, Grid, StreamDeckConfig};
    use std::sync::Arc;

    fn test_state(buttons: Vec<Button>) -> Arc<AppState> {
        let config = StreamDeckConfig { grid: Grid { rows: 2, cols: 3 }, buttons };
        let plugin_render = Arc::new(std::sync::Mutex::new(
            crate::server::state::PluginRenderState::default()
        ));
        let plugin_host = Arc::new(tokio::sync::Mutex::new(
            crate::plugin::PluginHost::new(config, Arc::clone(&plugin_render)),
        ));
        let dir = tempfile::tempdir().unwrap().keep();
        Arc::new(AppState {
            config_dir: dir,
            port: std::sync::Mutex::new(None),
            csrf_token: "test".into(),
            plugin_host,
            plugin_render,
            app_handle: std::sync::Mutex::new(None),
        })
    }

    #[tokio::test]
    async fn set_settings_updates_in_memory() {
        let state = test_state(vec![Button {
            name: "T".into(), icon: "x".into(),
            action_uuid: "com.pannacotta.system.open-app".into(),
            context: "ctx001".into(),
            settings: serde_json::json!({"appName": "Calculator"}),
            lan_allowed: None,
        }]);
        dispatch(serde_json::json!({
            "event": "setSettings",
            "context": "ctx001",
            "payload": {"appName": "Terminal"}
        }), "com.pannacotta.system", &state).await;
        let host = state.plugin_host.lock().await;
        let ps = host.profile_state.lock().await;
        let btn = ps.buttons.iter().find(|b| b.context == "ctx001").unwrap();
        assert_eq!(btn.settings["appName"], "Terminal");
    }

    #[tokio::test]
    async fn set_settings_unknown_context_no_panic() {
        let state = test_state(vec![]);
        dispatch(serde_json::json!({
            "event": "setSettings", "context": "unknown", "payload": {}
        }), "com.pannacotta.system", &state).await;
    }

    #[test]
    fn is_unsupported_detects_unknown_events() {
        assert!(!is_unsupported("setSettings"));
        assert!(!is_unsupported("getSettings"));
        assert!(!is_unsupported("openUrl"));
        assert!(!is_unsupported("logMessage"));
        assert!(!is_unsupported("setTitle"));
        assert!(!is_unsupported("showOk"));
        assert!(!is_unsupported("showAlert"));
        assert!(!is_unsupported("sendToPropertyInspector"));
        assert!(!is_unsupported("registerPlugin"));
        assert!(!is_unsupported("setImage"));
        assert!(!is_unsupported("setState"));
        assert!(!is_unsupported("setGlobalSettings"));
        assert!(!is_unsupported("getGlobalSettings"));
        assert!(is_unsupported("unknownFoo"));
    }

    #[tokio::test]
    async fn send_to_pi_no_panic_when_no_pi_sender() {
        let state = test_state(vec![]);
        dispatch(serde_json::json!({
            "event": "sendToPropertyInspector",
            "context": "ctx001",
            "action": "com.test.action",
            "payload": {"key": "value"}
        }), "com.test.plugin", &state).await;
        // No panic = pass
    }

    #[tokio::test]
    async fn set_image_stores_in_render_state() {
        let state = test_state(vec![]);
        dispatch(serde_json::json!({
            "event": "setImage",
            "context": "ctx001",
            "payload": { "image": "data:image/png;base64,abc=", "target": 0, "state": 0 }
        }), "com.spotify.sdPlugin", &state).await;
        let render = state.plugin_render.lock().unwrap();
        assert_eq!(render.images.get("ctx001").map(|s| s.as_str()), Some("data:image/png;base64,abc="));
    }

    #[tokio::test]
    async fn set_title_stores_in_render_state() {
        let state = test_state(vec![]);
        dispatch(serde_json::json!({
            "event": "setTitle",
            "context": "ctx001",
            "payload": { "title": "Bohemian Rhapsody", "target": 0 }
        }), "com.spotify.sdPlugin", &state).await;
        let render = state.plugin_render.lock().unwrap();
        assert_eq!(render.titles.get("ctx001").map(|s| s.as_str()), Some("Bohemian Rhapsody"));
    }

    #[tokio::test]
    async fn set_state_stores_in_render_state() {
        let state = test_state(vec![]);
        dispatch(serde_json::json!({
            "event": "setState",
            "context": "ctx001",
            "payload": { "state": 1 }
        }), "com.spotify.sdPlugin", &state).await;
        let render = state.plugin_render.lock().unwrap();
        assert_eq!(render.states.get("ctx001"), Some(&1u32));
    }

    #[tokio::test]
    async fn set_global_settings_persists_to_disk() {
        let state = test_state(vec![]);
        dispatch(serde_json::json!({
            "event": "setGlobalSettings",
            "payload": { "token": "secret123" }
        }), "com.spotify.sdPlugin", &state).await;
        let path = state.config_dir.join("globals").join("com.spotify.sdPlugin.json");
        let raw = tokio::fs::read_to_string(&path).await.unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(v["token"], "secret123");
    }

    #[tokio::test]
    async fn get_global_settings_does_not_panic() {
        let state = test_state(vec![]);
        let globals_dir = state.config_dir.join("globals");
        tokio::fs::create_dir_all(&globals_dir).await.unwrap();
        tokio::fs::write(
            globals_dir.join("com.spotify.sdPlugin.json"),
            r#"{"token":"xyz"}"#,
        ).await.unwrap();
        // Should not panic even with no registered plugin to send back to
        dispatch(serde_json::json!({
            "event": "getGlobalSettings",
            "context": "com.spotify.sdPlugin"
        }), "com.spotify.sdPlugin", &state).await;
    }
}
