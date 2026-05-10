use std::sync::Arc;
use crate::server::state::AppState;

const SUPPORTED: &[&str] = &[
    "registerPlugin", "registerPropertyInspector",
    "setTitle", "setSettings", "getSettings",
    "showOk", "showAlert", "openUrl", "logMessage",
    "sendToPropertyInspector", "sendToPlugin",
];

pub fn is_unsupported(event: &str) -> bool {
    !SUPPORTED.contains(&event)
}

pub async fn dispatch(msg: serde_json::Value, plugin_uuid: &str, state: &Arc<AppState>) {
    let event = msg.get("event").and_then(|v| v.as_str()).unwrap_or("");
    match event {
        "setSettings"             => on_set_settings(msg, plugin_uuid, state).await,
        "getSettings"             => on_get_settings(msg, plugin_uuid, state).await,
        "setTitle"                => on_set_title(&msg, plugin_uuid),
        "showOk"                  => on_show_ok(&msg, plugin_uuid),
        "showAlert"               => on_show_alert(&msg, plugin_uuid),
        "openUrl"                 => on_open_url(msg, plugin_uuid).await,
        "logMessage"              => on_log_message(&msg, plugin_uuid),
        "sendToPropertyInspector" => on_send_to_pi(&msg, plugin_uuid),
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

fn on_set_title(msg: &serde_json::Value, plugin_uuid: &str) {
    let ctx = msg.get("context").and_then(|v| v.as_str()).unwrap_or("?");
    let title = msg["payload"]["title"].as_str().unwrap_or("");
    tracing::info!(plugin=%plugin_uuid, ctx=%ctx, title=%title, "setTitle (UI not yet implemented)");
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

fn on_send_to_pi(msg: &serde_json::Value, plugin_uuid: &str) {
    let ctx = msg.get("context").and_then(|v| v.as_str()).unwrap_or("?");
    tracing::debug!(plugin=%plugin_uuid, ctx=%ctx, "sendToPropertyInspector (PI routing in Plan 2)");
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
        let plugin_host = Arc::new(tokio::sync::Mutex::new(
            crate::plugin::PluginHost::new(config),
        ));
        Arc::new(AppState {
            config_dir: "/tmp/test-inbound".into(),
            port: std::sync::Mutex::new(None),
            csrf_token: "test".into(),
            plugin_host,
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
        assert!(is_unsupported("setImage"));
        assert!(is_unsupported("setState"));
        assert!(is_unsupported("setGlobalSettings"));
        assert!(is_unsupported("unknownFoo"));
    }
}
