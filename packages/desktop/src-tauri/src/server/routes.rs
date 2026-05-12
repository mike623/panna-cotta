use axum::{
    body::Body,
    extract::{ConnectInfo, Path, State},
    http::{header, HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Json, Redirect, Response},
    routing::{get, patch, post, put},
    Router,
};
use include_dir::{include_dir, Dir};
use serde::Deserialize;
use serde_json::json;
use std::net::SocketAddr;
use std::sync::Arc;

use crate::server::state::{
    activate_profile, create_profile, default_config, delete_profile,
    list_profiles, rename_profile, save_stream_deck_config,
    use_stream_deck_config, AppState, StreamDeckConfig,
};

pub fn is_localhost_addr(addr: &SocketAddr) -> bool {
    let ip = addr.ip();
    ip == std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)
        || ip == std::net::IpAddr::V6(std::net::Ipv6Addr::LOCALHOST)
}

fn csrf_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

async fn validate_url(url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|_| format!("invalid URL: {url}"))?;
    match parsed.scheme() {
        "https" | "http" => Ok(()),
        s => Err(format!("URL scheme '{s}' not allowed; use https or http")),
    }
}

async fn require_admin(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    if !is_localhost_addr(&addr) {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({"error": "localhost only"}))).into_response();
    }
    let token_ok = headers
        .get("X-Panna-CSRF")
        .and_then(|v| v.to_str().ok())
        .map(|t| csrf_eq(t, &state.csrf_token))
        .unwrap_or(false);
    if !token_ok {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({"error": "invalid CSRF token"}))).into_response();
    }
    next.run(request).await
}

static APPS_DIR: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../../frontend");

pub fn create_router(state: Arc<AppState>) -> Router {
    let admin = Router::new()
        .route("/api/config", put(put_config))
        .route("/api/profiles", post(create_profile_handler))
        .route("/api/profiles/:name/activate", post(activate_profile_handler))
        .route("/api/profiles/:name", patch(rename_profile_handler).delete(delete_profile_handler))
        .route("/api/open-app", post(open_app_handler))
        .route("/api/open-url", post(open_url_handler))
        .route("/api/open-config-folder", post(open_config_folder_handler))
        .route("/api/plugins/install", post(install_plugin_handler))
        .route("/api/plugins/:uuid", axum::routing::delete(uninstall_plugin_handler))
        .layer(middleware::from_fn_with_state(state.clone(), require_admin));

    Router::new()
        .route("/", get(qr_page))
        .route("/apps", get(|| async { Redirect::permanent("/apps/") }))
        .route("/apps/", get(serve_apps_index))
        .route("/apps/*path", get(serve_apps_file))
        .route("/api/health", get(|| async { "OK" }))
        .route("/ws", get(crate::plugin::ws::ws_upgrade))
        .route("/api/config", get(get_config))
        .route("/api/config/default", get(get_default_config_handler))
        .route("/api/profiles", get(list_profiles_handler))
        .route("/api/execute", post(execute_handler))
        .route("/api/plugins", get(list_plugins_handler))
        .route("/api/plugins/:uuid/status", get(plugin_status_handler))
        .route("/api/plugin-render", get(get_plugin_render_handler))
        .route("/pi/:uuid/*path", get(serve_pi_file))
        .merge(admin)
        .with_state(state)
}

// ── Static file serving ──────────────────────────────────────────────

async fn serve_apps_index() -> impl IntoResponse {
    serve_file("index.html")
}

async fn serve_apps_file(Path(path): Path<String>) -> impl IntoResponse {
    serve_file(path.trim_start_matches('/'))
}

fn serve_file(path: &str) -> Response {
    match APPS_DIR.get_file(path) {
        Some(f) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            Response::builder()
                .header(header::CONTENT_TYPE, mime.as_ref())
                .body(Body::from(f.contents()))
                .unwrap()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

// ── QR setup page ─────────────────────────────────────────────────────

async fn qr_page(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let port = state.port.lock().unwrap().unwrap_or(30000);
    let ip = local_ip();
    let app_url = format!("http://{ip}:{port}/apps/");
    let qr_url = format!(
        "https://api.qrserver.com/v1/create-qr-code/?size=200x200&data={}",
        urlencoding::encode(&app_url)
    );
    let html = format!(r#"<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><title>Panna Cotta — Setup</title>
<style>body{{font-family:system-ui;display:flex;flex-direction:column;align-items:center;
justify-content:center;min-height:100vh;margin:0;background:#111;color:#eee}}
.card{{background:#1a1a2e;padding:2rem;border-radius:1rem;text-align:center;max-width:400px}}
h1{{margin:0 0 .5rem}}p{{color:#aaa}}img{{margin:1.5rem 0;border-radius:.5rem}}
code{{background:#2a2a3e;padding:.25rem .5rem;border-radius:.25rem}}
a{{color:#818cf8}}</style></head><body>
<div class="card"><h1>Panna Cotta</h1>
<p>Scan to open on your phone:</p>
<img src="{qr_url}" width="200" height="200" alt="QR">
<p>Or open: <a href="{app_url}"><code>{app_url}</code></a></p>
<p style="margin-top:1.5rem;border-top:1px solid #2a2a3e;padding-top:1rem">
<a href="/admin">&#9881; Admin</a></p></div></body></html>"#);
    axum::response::Html(html)
}

fn local_ip() -> String {
    use std::net::UdpSocket;
    UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| { s.connect("8.8.8.8:80")?; s.local_addr() })
        .map(|a| a.ip().to_string())
        .unwrap_or_else(|_| "localhost".to_string())
}

// ── Config handlers ───────────────────────────────────────────────────

async fn get_config(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let has_csrf = is_localhost_addr(&addr)
        && headers
            .get("X-Panna-CSRF")
            .and_then(|v| v.to_str().ok())
            .map(|t| csrf_eq(t, &state.csrf_token))
            .unwrap_or(false);

    match use_stream_deck_config(&state).await {
        Ok(mut cfg) => {
            if !has_csrf {
                for button in &mut cfg.buttons {
                    button.settings = serde_json::Value::Null;
                }
            }
            (StatusCode::OK, Json(serde_json::json!(cfg))).into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e}))).into_response(),
    }
}

async fn put_config(
    State(state): State<Arc<AppState>>,
    Json(body): Json<StreamDeckConfig>,
) -> impl IntoResponse {
    match save_stream_deck_config(&state, &body).await {
        Ok(_) => Json(json!({"ok": true})).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))).into_response(),
    }
}

async fn get_default_config_handler() -> impl IntoResponse {
    Json(json!(default_config()))
}

// ── Profile handlers ──────────────────────────────────────────────────

async fn list_profiles_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match list_profiles(&state).await {
        Ok(p) => Json(json!(p)).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))).into_response(),
    }
}

#[derive(Deserialize)]
struct NameBody { name: String }

async fn create_profile_handler(
    State(state): State<Arc<AppState>>,
    Json(body): Json<NameBody>,
) -> impl IntoResponse {
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "name required"}))).into_response();
    }
    // Return the sanitized name (what the file is actually named on disk)
    // so the client can refer to the profile in subsequent requests.
    let canonical = crate::server::state::safe_profile_name(&name);
    match create_profile(&state, &name, None).await {
        Ok(_) => match activate_profile(&state, &name).await {
            Ok(_) => Json(json!({"ok": true, "name": canonical})).into_response(),
            Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))).into_response(),
        },
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({"error": e}))).into_response(),
    }
}

async fn activate_profile_handler(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let name = match urlencoding::decode(&name) {
        Ok(s) => s.into_owned(),
        Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({"error": "invalid encoding"}))).into_response(),
    };
    match activate_profile(&state, &name).await {
        Ok(_) => Json(json!({"ok": true})).into_response(),
        Err(e) => (StatusCode::NOT_FOUND, Json(json!({"error": e}))).into_response(),
    }
}

#[derive(Deserialize)]
struct RenameBody { #[serde(rename = "newName")] new_name: String }

async fn rename_profile_handler(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Json(body): Json<RenameBody>,
) -> impl IntoResponse {
    let old = match urlencoding::decode(&name) {
        Ok(s) => s.into_owned(),
        Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({"error": "invalid encoding"}))).into_response(),
    };
    let new = body.new_name.trim().to_string();
    if new.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "newName required"}))).into_response();
    }
    match rename_profile(&state, &old, &new).await {
        Ok(_) => Json(json!({"ok": true, "name": new})).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({"error": e}))).into_response(),
    }
}

async fn delete_profile_handler(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let name = match urlencoding::decode(&name) {
        Ok(s) => s.into_owned(),
        Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({"error": "invalid encoding"}))).into_response(),
    };
    match delete_profile(&state, &name).await {
        Ok(_) => Json(json!({"ok": true})).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({"error": e}))).into_response(),
    }
}

// ── System handlers ───────────────────────────────────────────────────

#[derive(serde::Deserialize)]
struct ExecuteBody {
    context: Option<String>,
}

async fn execute_handler(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<ExecuteBody>,
) -> impl IntoResponse {
    let is_local = is_localhost_addr(&addr);

    if is_local {
        let csrf_ok = headers
            .get("X-Panna-CSRF")
            .and_then(|v| v.to_str().ok())
            .map(|t| csrf_eq(t, &state.csrf_token))
            .unwrap_or(false);
        if !csrf_ok {
            return (StatusCode::FORBIDDEN, Json(serde_json::json!({"error": "CSRF required"}))).into_response();
        }
    }

    if let Some(ctx) = body.context {
        let config = match use_stream_deck_config(&state).await {
            Ok(c) => c,
            Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e}))).into_response(),
        };
        let button = match config.buttons.iter().find(|b| b.context == ctx) {
            Some(b) => b.clone(),
            None => return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "context not found"}))).into_response(),
        };
        if button.lan_allowed == Some(false) && !is_local {
            return (StatusCode::FORBIDDEN, Json(serde_json::json!({"error": "not allowed from LAN"}))).into_response();
        }
        let plugin_dispatched = {
            let host = state.plugin_host.lock().await;
            if let Some(plugin_uuid) = host.plugin_for_action(&button.action_uuid).map(|s| s.to_string()) {
                let (index, cols) = {
                    let ps = host.profile_state.lock().await;
                    let idx = ps.buttons.iter().position(|b| b.context == button.context).unwrap_or(0);
                    (idx, ps.grid.cols)
                };
                let msg = crate::events::outbound::key_down_with_settings(
                    &button.action_uuid, &button.context, &button.settings, index, cols,
                );
                host.try_send(&plugin_uuid, msg)
            } else {
                false
            }
        };
        let result = if plugin_dispatched {
            Ok(())
        } else {
            Err(format!("no plugin running for actionUUID: {}", button.action_uuid))
        };
        match result {
            Ok(()) => {
                tracing::info!(action = %button.action_uuid, context = %button.context, "button dispatch ok");
                Json(serde_json::json!({"success": true})).into_response()
            }
            Err(e) => {
                tracing::warn!(action = %button.action_uuid, context = %button.context, error = %e, "button dispatch failed");
                (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({"error": e}))).into_response()
            }
        }
    } else {
        (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "provide {context}"}))).into_response()
    }
}

#[derive(Deserialize)]
struct AppBody { #[serde(rename = "appName")] app_name: String }

async fn open_app_handler(Json(body): Json<AppBody>) -> impl IntoResponse {
    match crate::commands::system::open_app(body.app_name).await {
        Ok(_) => Json(json!({"success": true})).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"success": false, "message": e}))).into_response(),
    }
}

#[derive(Deserialize)]
struct UrlBody { url: String }

async fn open_url_handler(Json(body): Json<UrlBody>) -> impl IntoResponse {
    if let Err(e) = validate_url(&body.url).await {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": e}))).into_response();
    }
    match crate::commands::system::open_url(body.url).await {
        Ok(_) => Json(json!({"success": true})).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"success": false, "message": e}))).into_response(),
    }
}

async fn open_config_folder_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let dir = state.config_dir.to_string_lossy().to_string();
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(&dir).spawn();
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("explorer").arg(&dir).spawn();
    #[cfg(target_os = "linux")]
    let _ = std::process::Command::new("xdg-open").arg(&dir).spawn();
    Json(json!({"ok": true}))
}

// ── Plugin handlers ───────────────────────────────────────────────────

async fn list_plugins_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    struct PluginSnapshot {
        uuid: String,
        name: String,
        version: String,
        author: String,
        description: String,
        status: &'static str,
        actions: Vec<(String, String, Option<String>)>, // (uuid, name, pi_path)
    }

    let snapshots: Vec<PluginSnapshot> = {
        let host = state.plugin_host.lock().await;
        host.manifests.iter().map(|(uuid, manifest)| {
            let status = host.plugins.get(uuid)
                .map(|ps| match &ps.status {
                    crate::plugin::PluginStatus::Running   => "running",
                    crate::plugin::PluginStatus::Starting  => "starting",
                    crate::plugin::PluginStatus::Stopped   => "stopped",
                    crate::plugin::PluginStatus::Errored(_) => "errored",
                })
                .unwrap_or("not_spawned");
            PluginSnapshot {
                uuid: uuid.clone(),
                name: manifest.name.clone(),
                version: manifest.version.clone(),
                author: manifest.author.clone(),
                description: manifest.description.clone(),
                status,
                actions: manifest.actions.iter().map(|a| (a.uuid.clone(), a.name.clone(), a.property_inspector_path.clone())).collect(),
            }
        }).collect()
    }; // guard dropped here

    let plugins: Vec<serde_json::Value> = snapshots.into_iter().map(|s| {
        serde_json::json!({
            "uuid": s.uuid,
            "name": s.name,
            "version": s.version,
            "author": s.author,
            "description": s.description,
            "status": s.status,
            "actions": s.actions.iter().map(|(u, n, pi)| {
                let mut obj = serde_json::json!({"uuid": u, "name": n});
                if let Some(path) = pi {
                    obj["piPath"] = serde_json::Value::String(path.clone());
                }
                obj
            }).collect::<Vec<_>>(),
        })
    }).collect();
    Json(serde_json::json!({ "plugins": plugins }))
}

async fn plugin_status_handler(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> impl IntoResponse {
    let has_csrf = is_localhost_addr(&addr) && headers
        .get("X-Panna-CSRF")
        .and_then(|v| v.to_str().ok())
        .map(|t| csrf_eq(t, &state.csrf_token))
        .unwrap_or(false);

    // Collect data under lock, then drop before building response
    struct StatusSnapshot {
        status_str: String,
        crash_count: u32,
        unsupported_events: Vec<String>,
        settings_not_persisted: bool,
    }

    let snapshot = {
        let host = state.plugin_host.lock().await;
        if !host.manifests.contains_key(&uuid) {
            return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "plugin not found"}))).into_response();
        }
        let ps = host.plugins.get(&uuid);
        let status_str = ps.map(|p| match &p.status {
            crate::plugin::PluginStatus::Running    => "running".to_string(),
            crate::plugin::PluginStatus::Starting   => "starting".to_string(),
            crate::plugin::PluginStatus::Stopped    => "stopped".to_string(),
            crate::plugin::PluginStatus::Errored(_) => "errored".to_string(),
        }).unwrap_or_else(|| "not_spawned".to_string());
        let mut unsupported: Vec<String> = ps.map(|p| p.unsupported_events.iter().cloned().collect()).unwrap_or_default();
        unsupported.sort();
        StatusSnapshot {
            status_str,
            crash_count: ps.map(|p| p.crash_count).unwrap_or(0),
            unsupported_events: unsupported,
            settings_not_persisted: ps.map(|p| p.settings_not_persisted).unwrap_or(false),
        }
    }; // guard dropped here

    let mut response = serde_json::json!({
        "uuid": &uuid,
        "status": snapshot.status_str,
        "crashCount": snapshot.crash_count,
        "unsupportedEvents": snapshot.unsupported_events,
        "settingsNotPersisted": snapshot.settings_not_persisted,
    });

    if has_csrf {
        response["logTail"] = serde_json::json!(null);
    }

    Json(response).into_response()
}

async fn install_plugin_handler() -> impl IntoResponse {
    (StatusCode::NOT_IMPLEMENTED, Json(serde_json::json!({"error": "plugin install not yet implemented"})))
}

async fn uninstall_plugin_handler(Path(_uuid): Path<String>) -> impl IntoResponse {
    (StatusCode::NOT_IMPLEMENTED, Json(serde_json::json!({"error": "plugin uninstall not yet implemented"})))
}

async fn get_plugin_render_handler(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    match state.plugin_render.lock() {
        Ok(render) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "images": render.images,
                "titles": render.titles,
                "states": render.states,
            })),
        )
            .into_response(),
        Err(e) => {
            tracing::error!(error=%e, "plugin_render mutex poisoned");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal error"})),
            )
                .into_response()
        }
    }
}

// ── Plugin Inspector (PI) file server ────────────────────────────────

async fn serve_pi_file(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path((plugin_uuid, rel_path)): Path<(String, String)>,
) -> impl IntoResponse {
    if !is_localhost_addr(&addr) {
        return StatusCode::FORBIDDEN.into_response();
    }

    // Path safety: no traversal, no absolute paths
    if rel_path.contains("..") || rel_path.starts_with('/') {
        return StatusCode::BAD_REQUEST.into_response();
    }

    let plugin_dir = {
        let host = state.plugin_host.lock().await;
        host.plugin_dirs.get(&plugin_uuid).cloned()
    };

    let plugin_dir = match plugin_dir {
        Some(d) => d,
        None => return StatusCode::NOT_FOUND.into_response(),
    };

    let file_path = plugin_dir.join(&rel_path);
    let bytes = match tokio::fs::read(&file_path).await {
        Ok(b) => b,
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    };

    let mime = mime_guess::from_path(&rel_path).first_or_octet_stream();
    let content_type = mime.as_ref().to_string();

    if content_type.contains("text/html") {
        let token: String = {
            use rand::Rng;
            let token_bytes: [u8; 32] = rand::thread_rng().gen();
            token_bytes.iter().map(|b| format!("{:02x}", b)).collect()
        };
        {
            let mut host = state.plugin_host.lock().await;
            host.pi_token_map.insert(token.clone(), plugin_uuid.clone());
        }
        let html = String::from_utf8_lossy(&bytes);
        let bridge = format!(
            r#"<script>
const PI_TOKEN = '{token}';
window.connectElgatoStreamDeckSocket = function(inPort, inUUID, inRegisterEvent, inInfo, inActionInfo) {{
  const ws = new WebSocket(`ws://127.0.0.1:${{inPort}}/ws?token=${{PI_TOKEN}}`);
  ws.onopen = () => ws.send(JSON.stringify({{
    event: inRegisterEvent,
    uuid: inUUID,
    actionInfo: typeof inActionInfo === 'string' ? JSON.parse(inActionInfo) : inActionInfo
  }}));
  ws.onmessage = (e) => {{
    const msg = JSON.parse(e.data);
    window.dispatchEvent(new MessageEvent(msg.event || 'message', {{ data: e.data }}));
  }};
}};
</script>"#
        );
        let injected = if html.contains("</body>") {
            html.replacen("</body>", &format!("{bridge}</body>"), 1)
        } else {
            format!("{html}{bridge}")
        };
        return (
            StatusCode::OK,
            [
                (axum::http::header::CONTENT_TYPE, "text/html; charset=utf-8"),
                (
                    axum::http::header::CONTENT_SECURITY_POLICY,
                    "default-src 'self'; script-src 'unsafe-inline' 'self'; connect-src ws://127.0.0.1:* 'self'",
                ),
            ],
            injected,
        ).into_response();
    }

    (
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, content_type)],
        bytes,
    ).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;
    use tempfile;

    fn make_state(csrf: &str) -> Arc<AppState> {
        use std::sync::Mutex;
        use std::path::PathBuf;
        let plugin_render = Arc::new(Mutex::new(
            crate::server::state::PluginRenderState::default()
        ));
        let plugin_host = Arc::new(tokio::sync::Mutex::new(
            crate::plugin::PluginHost::new(
                crate::server::state::default_config(),
                Arc::clone(&plugin_render),
            ),
        ));
        Arc::new(AppState {
            config_dir: PathBuf::from("/tmp/test-panna"),
            port: Mutex::new(None),
            csrf_token: csrf.to_string(),
            plugin_host,
            plugin_render,
            app_handle: Mutex::new(None),
        })
    }

    fn lan_addr() -> std::net::SocketAddr {
        "192.168.1.100:54321".parse().unwrap()
    }

    fn local_addr() -> std::net::SocketAddr {
        "127.0.0.1:54321".parse().unwrap()
    }

    #[test]
    fn is_localhost_addr_loopback() {
        assert!(is_localhost_addr(&"127.0.0.1:0".parse().unwrap()));
        assert!(is_localhost_addr(&"[::1]:0".parse().unwrap()));
        assert!(!is_localhost_addr(&"192.168.1.1:0".parse().unwrap()));
        assert!(!is_localhost_addr(&"10.0.0.1:0".parse().unwrap()));
    }

    #[tokio::test]
    async fn admin_route_from_lan_returns_403() {
        let csrf = "aabbcc";
        let state = make_state(csrf);
        let app = create_router(state.clone());
        let req = Request::builder()
            .method("PUT")
            .uri("/api/config")
            .header("Content-Type", "application/json")
            .extension(axum::extract::ConnectInfo(lan_addr()))
            .header("X-Panna-CSRF", csrf)
            .body(Body::from(r#"{"grid":{"rows":2,"cols":3},"buttons":[]}"#))
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), 403);
    }

    #[tokio::test]
    async fn admin_route_localhost_missing_csrf_returns_403() {
        let state = make_state("secret123");
        let app = create_router(state.clone());
        let req = Request::builder()
            .method("PUT")
            .uri("/api/config")
            .header("Content-Type", "application/json")
            .extension(axum::extract::ConnectInfo(local_addr()))
            .body(Body::from(r#"{"grid":{"rows":2,"cols":3},"buttons":[]}"#))
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), 403);
    }

    #[tokio::test]
    async fn admin_route_localhost_wrong_csrf_returns_403() {
        let state = make_state("correct_token");
        let app = create_router(state.clone());
        let req = Request::builder()
            .method("PUT")
            .uri("/api/config")
            .header("Content-Type", "application/json")
            .extension(axum::extract::ConnectInfo(local_addr()))
            .header("X-Panna-CSRF", "wrong_token")
            .body(Body::from(r#"{"grid":{"rows":2,"cols":3},"buttons":[]}"#))
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), 403);
    }

    async fn state_with_profile(csrf: &str, buttons: Vec<crate::server::state::Button>) -> Arc<AppState> {
        let dir: tempfile::TempDir = tempfile::tempdir().unwrap();
        let dir_path = dir.keep(); // persist dir on disk so it lives past function
        let profiles_dir = dir_path.join("profiles");
        tokio::fs::create_dir_all(&profiles_dir).await.unwrap();
        let config = crate::server::state::StreamDeckConfig {
            grid: crate::server::state::Grid { rows: 2, cols: 3 },
            buttons: buttons.clone(),
        };
        let json = serde_json::to_string_pretty(&config).unwrap();
        tokio::fs::write(profiles_dir.join("Default.json"), &json).await.unwrap();
        tokio::fs::write(dir_path.join("active-profile"), "Default").await.unwrap();
        let plugin_render = Arc::new(std::sync::Mutex::new(
            crate::server::state::PluginRenderState::default()
        ));
        let plugin_host = Arc::new(tokio::sync::Mutex::new(
            crate::plugin::PluginHost::new(config, Arc::clone(&plugin_render)),
        ));
        Arc::new(AppState {
            config_dir: dir_path,
            port: std::sync::Mutex::new(None),
            csrf_token: csrf.to_string(),
            plugin_host,
            plugin_render,
            app_handle: std::sync::Mutex::new(None),
        })
    }

    #[tokio::test]
    async fn execute_context_from_lan_accepted() {
        let buttons = vec![crate::server::state::Button {
            name: "Vol Up".into(),
            icon: "v".into(),
            action_uuid: "com.pannacotta.system.volume-up".into(),
            context: "ctx001".into(),
            settings: serde_json::json!({}),
            lan_allowed: None,
        }];
        let state = state_with_profile("tok", buttons).await;
        let app = create_router(state.clone());
        let req = Request::builder()
            .method("POST")
            .uri("/api/execute")
            .header("Content-Type", "application/json")
            .extension(axum::extract::ConnectInfo(lan_addr()))
            .body(Body::from(r#"{"context":"ctx001"}"#))
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        // 200 or 500 (system command may fail in test env), but NOT 400 or 403
        assert!(res.status() != 400 && res.status() != 403, "got {}", res.status());
    }

    #[tokio::test]
    async fn execute_legacy_from_lan_rejected() {
        let state = make_state("tok");
        let app = create_router(state.clone());
        let req = Request::builder()
            .method("POST")
            .uri("/api/execute")
            .header("Content-Type", "application/json")
            .extension(axum::extract::ConnectInfo(lan_addr()))
            .body(Body::from(r#"{"action":"open-app","target":"Calculator"}"#))
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), 400);
    }

    #[tokio::test]
    async fn execute_lan_allowed_false_returns_403() {
        let buttons = vec![crate::server::state::Button {
            name: "Secret".into(),
            icon: "x".into(),
            action_uuid: "com.pannacotta.system.open-app".into(),
            context: "secret1".into(),
            settings: serde_json::json!({"appName": "Terminal"}),
            lan_allowed: Some(false),
        }];
        let state = state_with_profile("tok", buttons).await;
        let app = create_router(state.clone());
        let req = Request::builder()
            .method("POST")
            .uri("/api/execute")
            .header("Content-Type", "application/json")
            .extension(axum::extract::ConnectInfo(lan_addr()))
            .body(Body::from(r#"{"context":"secret1"}"#))
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), 403);
    }

    #[tokio::test]
    async fn execute_unknown_context_returns_404() {
        let buttons = vec![];
        let state = state_with_profile("tok", buttons).await;
        let app = create_router(state.clone());
        let req = Request::builder()
            .method("POST")
            .uri("/api/execute")
            .header("Content-Type", "application/json")
            .extension(axum::extract::ConnectInfo(lan_addr()))
            .body(Body::from(r#"{"context":"nosuchctx"}"#))
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), 404);
    }

    #[tokio::test]
    async fn get_config_redacts_settings_without_csrf() {
        let buttons = vec![crate::server::state::Button {
            name: "Secret".into(),
            icon: "x".into(),
            action_uuid: "com.pannacotta.system.open-app".into(),
            context: "ctx123".into(),
            settings: serde_json::json!({"appName": "Terminal", "secret": "data"}),
            lan_allowed: None,
        }];
        let state = state_with_profile("mytoken", buttons).await;
        let app = create_router(state.clone());
        let req = Request::builder()
            .method("GET")
            .uri("/api/config")
            .extension(axum::extract::ConnectInfo(lan_addr()))
            .body(Body::empty())
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), 200);
        let body = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        // settings should be stripped (null or absent)
        let btn = &json["buttons"][0];
        let settings = &btn["settings"];
        assert!(settings.is_null() || settings == &serde_json::Value::Null,
            "settings should be redacted, got: {btn}");
        // Other fields still present
        assert_eq!(btn["context"], "ctx123");
        assert_eq!(btn["name"], "Secret");
    }

    #[tokio::test]
    async fn open_url_from_lan_rejected() {
        let state = make_state("tok");
        let app = create_router(state);
        let req = Request::builder()
            .method("POST")
            .uri("/api/open-url")
            .header("Content-Type", "application/json")
            .extension(axum::extract::ConnectInfo(lan_addr()))
            .body(Body::from(r#"{"url":"https://example.com"}"#))
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), 403);
    }

    #[tokio::test]
    async fn ws_from_lan_returns_403() {
        let state = make_state("tok");
        let app = create_router(state);
        let req = Request::builder()
            .method("GET").uri("/ws")
            .header("Upgrade", "websocket")
            .header("Connection", "Upgrade")
            .header("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
            .header("Sec-WebSocket-Version", "13")
            .extension(axum::extract::ConnectInfo(lan_addr()))
            .body(Body::empty()).unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), 403);
    }

    #[tokio::test]
    async fn ws_bad_origin_returns_403() {
        let state = make_state("tok");
        let app = create_router(state);
        let req = Request::builder()
            .method("GET").uri("/ws")
            .header("Upgrade", "websocket")
            .header("Connection", "Upgrade")
            .header("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
            .header("Sec-WebSocket-Version", "13")
            .header("Origin", "https://evil.com")
            .extension(axum::extract::ConnectInfo(local_addr()))
            .body(Body::empty()).unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), 403);
    }

    #[tokio::test]
    async fn ws_localhost_no_origin_accepted() {
        let state = make_state("tok");
        let app = create_router(state);
        let req = Request::builder()
            .method("GET").uri("/ws")
            .header("Upgrade", "websocket")
            .header("Connection", "Upgrade")
            .header("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
            .header("Sec-WebSocket-Version", "13")
            // No Origin header = native process (plugin)
            .extension(axum::extract::ConnectInfo(local_addr()))
            .body(Body::empty()).unwrap();
        let res = app.oneshot(req).await.unwrap();
        // oneshot doesn't establish a real WS connection (no hyper upgrade ext),
        // so 101 isn't reachable; just verify auth passed (not blocked with 403)
        assert_ne!(res.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn get_plugins_returns_empty_list() {
        let state = make_state("tok");
        let app = create_router(state);
        let req = Request::builder()
            .method("GET")
            .uri("/api/plugins")
            .extension(axum::extract::ConnectInfo(local_addr()))
            .body(Body::empty())
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), 200);
        let body = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(json["plugins"].as_array().unwrap().is_empty());
    }

    #[tokio::test]
    async fn get_plugins_accessible_from_lan() {
        let state = make_state("tok");
        let app = create_router(state);
        let req = Request::builder()
            .method("GET")
            .uri("/api/plugins")
            .extension(axum::extract::ConnectInfo(lan_addr()))
            .body(Body::empty())
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), 200);
    }

    #[tokio::test]
    async fn plugin_status_unknown_uuid_returns_404() {
        let state = make_state("tok");
        let app = create_router(state);
        let req = Request::builder()
            .method("GET")
            .uri("/api/plugins/com.nobody.plugin/status")
            .extension(axum::extract::ConnectInfo(local_addr()))
            .body(Body::empty())
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), 404);
    }

    #[tokio::test]
    async fn install_plugin_returns_501() {
        let state = make_state("tok");
        let app = create_router(state.clone());
        let req = Request::builder()
            .method("POST")
            .uri("/api/plugins/install")
            .header("X-Panna-CSRF", "tok")
            .header("Content-Type", "application/json")
            .extension(axum::extract::ConnectInfo(local_addr()))
            .body(Body::from(r#"{"source":"npm","name":"my-plugin"}"#))
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), 501);
    }

    #[tokio::test]
    async fn get_config_includes_settings_with_csrf() {
        let buttons = vec![crate::server::state::Button {
            name: "Secret".into(),
            icon: "x".into(),
            action_uuid: "com.pannacotta.system.open-app".into(),
            context: "ctx456".into(),
            settings: serde_json::json!({"appName": "Terminal"}),
            lan_allowed: None,
        }];
        let state = state_with_profile("mytoken", buttons).await;
        let app = create_router(state.clone());
        let req = Request::builder()
            .method("GET")
            .uri("/api/config")
            .header("X-Panna-CSRF", "mytoken")
            .extension(axum::extract::ConnectInfo(local_addr()))
            .body(Body::empty())
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        let body = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let btn = &json["buttons"][0];
        assert_eq!(btn["settings"]["appName"], "Terminal");
    }

    #[tokio::test]
    async fn pi_route_from_lan_returns_403() {
        let state = make_state("tok");
        let app = create_router(state);
        let req = Request::builder()
            .method("GET")
            .uri("/pi/com.test.plugin/pi.html")
            .extension(axum::extract::ConnectInfo(lan_addr()))
            .body(Body::empty())
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), 403);
    }

    #[tokio::test]
    async fn pi_route_unknown_plugin_returns_404() {
        let state = make_state("tok");
        let app = create_router(state);
        let req = Request::builder()
            .method("GET")
            .uri("/pi/com.unknown.plugin/pi.html")
            .extension(axum::extract::ConnectInfo(local_addr()))
            .body(Body::empty())
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), 404);
    }

    #[tokio::test]
    async fn pi_route_path_traversal_rejected() {
        let state = make_state("tok");
        let app = create_router(state);
        let req = Request::builder()
            .method("GET")
            .uri("/pi/com.test.plugin/../../../etc/passwd")
            .extension(axum::extract::ConnectInfo(local_addr()))
            .body(Body::empty())
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        // 400 or 404 — either is correct since URI normalization may strip traversal
        assert!(res.status() == 400 || res.status() == 404);
    }

    #[tokio::test]
    async fn plugin_status_logtail_gated_by_csrf() {
        let state = make_state("tok");
        // Insert a known plugin manifest
        {
            let mut host = state.plugin_host.lock().await;
            host.manifests.insert("com.test.plugin".into(), crate::plugin::manifest::Manifest {
                uuid: "com.test.plugin".into(),
                name: "Test".into(),
                version: "1.0.0".into(),
                author: "A".into(),
                description: "d".into(),
                sdk_version: 2,
                code_path: "bin/plugin.js".into(),
                os: vec![],
                actions: vec![crate::plugin::manifest::Action {
                    uuid: "com.test.plugin.action1".into(),
                    name: "Action 1".into(),
                    property_inspector_path: Some("pi/index.html".into()),
                }],
            });
        }

        // Without CSRF: logTail should be absent
        let app = create_router(state.clone());
        let req = Request::builder()
            .method("GET")
            .uri("/api/plugins/com.test.plugin/status")
            .extension(axum::extract::ConnectInfo(local_addr()))
            .body(Body::empty())
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), 200);
        let body = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(json.get("logTail").is_none(), "logTail should be absent without CSRF");

        // With CSRF: logTail should be present (null)
        let app = create_router(state.clone());
        let req = Request::builder()
            .method("GET")
            .uri("/api/plugins/com.test.plugin/status")
            .header("X-Panna-CSRF", "tok")
            .extension(axum::extract::ConnectInfo(local_addr()))
            .body(Body::empty())
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), 200);
        let body = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(json.get("logTail").is_some(), "logTail should be present with valid CSRF");
    }

    #[tokio::test]
    async fn plugin_render_returns_empty_maps() {
        let state = make_state("tok");
        let app = create_router(state);
        let req = Request::builder()
            .uri("/api/plugin-render")
            .body(Body::empty())
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let body = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(json["images"].is_object());
        assert!(json["titles"].is_object());
        assert!(json["states"].is_object());
    }

    // ── GET /api/config — full button list contract ──────────────────────
    //
    // Documents the on-the-wire contract: GET /api/config does NOT filter
    // out buttons with lanAllowed: false. It only redacts the `settings`
    // field when there is no CSRF (LAN clients). The enforcement of
    // lanAllowed happens at EXECUTE time (see execute_lan_allowed_false_returns_403).

    #[tokio::test]
    async fn get_config_returns_lan_allowed_false_buttons_with_settings_redacted() {
        let buttons = vec![
            crate::server::state::Button {
                name: "Public".into(),
                icon: "a".into(),
                action_uuid: "com.pannacotta.system.open-app".into(),
                context: "pub1".into(),
                settings: serde_json::json!({"appName": "Calculator"}),
                lan_allowed: Some(true),
            },
            crate::server::state::Button {
                name: "Private".into(),
                icon: "b".into(),
                action_uuid: "com.pannacotta.system.open-app".into(),
                context: "priv1".into(),
                settings: serde_json::json!({"appName": "Terminal"}),
                lan_allowed: Some(false),
            },
        ];
        let state = state_with_profile("tok", buttons).await;
        let app = create_router(state);
        let req = Request::builder()
            .method("GET")
            .uri("/api/config")
            .extension(axum::extract::ConnectInfo(lan_addr()))
            .body(Body::empty())
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), 200);
        let body = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let buttons = json["buttons"].as_array().unwrap();
        assert_eq!(buttons.len(), 2, "all buttons listed regardless of lanAllowed");
        // Settings stripped for both (LAN, no CSRF)
        for b in buttons {
            assert!(b["settings"].is_null(), "settings must be redacted on LAN");
        }
        // Context still present so phone can call /api/execute by context
        assert!(buttons.iter().any(|b| b["context"] == "pub1"));
        assert!(buttons.iter().any(|b| b["context"] == "priv1"));
    }

    // ── /api/execute CSRF behavior on localhost ──────────────────────────

    #[tokio::test]
    async fn execute_from_localhost_without_csrf_returns_403() {
        let buttons = vec![crate::server::state::Button {
            name: "Vol".into(),
            icon: "v".into(),
            action_uuid: "com.pannacotta.system.volume-up".into(),
            context: "vol1".into(),
            settings: serde_json::json!({}),
            lan_allowed: None,
        }];
        let state = state_with_profile("the_real_token", buttons).await;
        let app = create_router(state);
        let req = Request::builder()
            .method("POST")
            .uri("/api/execute")
            .header("Content-Type", "application/json")
            .extension(axum::extract::ConnectInfo(local_addr()))
            .body(Body::from(r#"{"context":"vol1"}"#))
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), 403);
    }

    #[tokio::test]
    async fn execute_from_localhost_with_wrong_csrf_returns_403() {
        let buttons = vec![crate::server::state::Button {
            name: "Vol".into(),
            icon: "v".into(),
            action_uuid: "com.pannacotta.system.volume-up".into(),
            context: "vol1".into(),
            settings: serde_json::json!({}),
            lan_allowed: None,
        }];
        let state = state_with_profile("correct_token", buttons).await;
        let app = create_router(state);
        let req = Request::builder()
            .method("POST")
            .uri("/api/execute")
            .header("Content-Type", "application/json")
            .header("X-Panna-CSRF", "wrong")
            .extension(axum::extract::ConnectInfo(local_addr()))
            .body(Body::from(r#"{"context":"vol1"}"#))
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), 403);
    }

    #[tokio::test]
    async fn execute_from_localhost_with_valid_csrf_passes_auth() {
        // 200 if a plugin is running, or 503 if no plugin registered.
        // Both prove auth passed (not 403, not 400).
        let buttons = vec![crate::server::state::Button {
            name: "Vol".into(),
            icon: "v".into(),
            action_uuid: "com.pannacotta.system.volume-up".into(),
            context: "vol1".into(),
            settings: serde_json::json!({}),
            lan_allowed: None,
        }];
        let state = state_with_profile("good_token", buttons).await;
        let app = create_router(state);
        let req = Request::builder()
            .method("POST")
            .uri("/api/execute")
            .header("Content-Type", "application/json")
            .header("X-Panna-CSRF", "good_token")
            .extension(axum::extract::ConnectInfo(local_addr()))
            .body(Body::from(r#"{"context":"vol1"}"#))
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert!(
            res.status() != 403 && res.status() != 400,
            "auth should pass, got {}",
            res.status()
        );
    }

    // ── Profile creation: invalid names ──────────────────────────────────

    #[tokio::test]
    async fn create_profile_empty_name_returns_400() {
        let state = state_with_profile("tok", vec![]).await;
        let app = create_router(state);
        let req = Request::builder()
            .method("POST")
            .uri("/api/profiles")
            .header("Content-Type", "application/json")
            .header("X-Panna-CSRF", "tok")
            .extension(axum::extract::ConnectInfo(local_addr()))
            .body(Body::from(r#"{"name":""}"#))
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), 400);
    }

    #[tokio::test]
    async fn create_profile_whitespace_only_name_returns_400() {
        let state = state_with_profile("tok", vec![]).await;
        let app = create_router(state);
        let req = Request::builder()
            .method("POST")
            .uri("/api/profiles")
            .header("Content-Type", "application/json")
            .header("X-Panna-CSRF", "tok")
            .extension(axum::extract::ConnectInfo(local_addr()))
            .body(Body::from(r#"{"name":"   "}"#))
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), 400);
    }

    #[tokio::test]
    async fn create_profile_path_traversal_sanitized_to_safe_name() {
        // safe_profile_name strips '/' and other special chars, so
        // "../etc/passwd" becomes "etcpasswd" — no filesystem escape.
        let state = state_with_profile("tok", vec![]).await;
        let app = create_router(state.clone());
        let req = Request::builder()
            .method("POST")
            .uri("/api/profiles")
            .header("Content-Type", "application/json")
            .header("X-Panna-CSRF", "tok")
            .extension(axum::extract::ConnectInfo(local_addr()))
            .body(Body::from(r#"{"name":"../etc/passwd"}"#))
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        // The request succeeds because safe_profile_name sanitizes; the
        // resulting profile lives at <profiles_dir>/etcpasswd.json — INSIDE
        // the profiles_dir, NOT at /etc/passwd.
        assert_eq!(res.status(), 200);
        let body = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let returned_name = json["name"].as_str().unwrap();
        assert!(
            !returned_name.contains('/') && !returned_name.contains(".."),
            "returned name '{returned_name}' must not contain slashes or dots"
        );
        // And nothing was written outside profiles_dir
        assert!(
            !std::path::Path::new("/etc/passwd.json").exists(),
            "must NOT escape filesystem"
        );
        let created = state.profiles_dir().join(format!("{returned_name}.json"));
        assert!(created.exists(), "profile must live inside profiles_dir");
    }

    #[tokio::test]
    async fn create_profile_null_byte_in_name_sanitized() {
        // safe_profile_name strips non-alphanumeric chars (except space/_/-)
        // so null bytes are removed.
        let state = state_with_profile("tok", vec![]).await;
        let app = create_router(state.clone());
        // "Work\0Evil" — name contains \0 which would be a path-injection
        // primitive in many systems. safe_profile_name must strip it.
        let body_json = serde_json::json!({"name": "Work\u{0}Evil"});
        let req = Request::builder()
            .method("POST")
            .uri("/api/profiles")
            .header("Content-Type", "application/json")
            .header("X-Panna-CSRF", "tok")
            .extension(axum::extract::ConnectInfo(local_addr()))
            .body(Body::from(body_json.to_string()))
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), 200);
        let body = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        // Returned name preserves spaces but the on-disk file uses
        // safe_profile_name. The endpoint returns the trimmed input name
        // (which still contains the null byte literally in JSON), so we
        // assert the on-disk side: a file exists at the safe name.
        let name = json["name"].as_str().unwrap();
        let safe = crate::server::state::safe_profile_name(name);
        let path = state.profiles_dir().join(format!("{safe}.json"));
        assert!(path.exists(), "profile file must exist at safe path");
        assert!(!safe.contains('\0'), "safe name must not contain null byte");
    }

    #[tokio::test]
    async fn rename_profile_via_route_atomically_renames() {
        // PATCH /api/profiles/:name — old file gone, new file has same
        // contents.
        let state = state_with_profile("tok", vec![]).await;

        // Pre-seed a profile to rename
        crate::server::state::create_profile(&state, "Work", None)
            .await
            .unwrap();
        let before = tokio::fs::read_to_string(
            crate::server::state::profile_json_path(&state, "Work"),
        )
        .await
        .unwrap();

        let app = create_router(state.clone());
        let req = Request::builder()
            .method("PATCH")
            .uri("/api/profiles/Work")
            .header("Content-Type", "application/json")
            .header("X-Panna-CSRF", "tok")
            .extension(axum::extract::ConnectInfo(local_addr()))
            .body(Body::from(r#"{"newName":"Personal"}"#))
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), 200);

        let work_path = crate::server::state::profile_json_path(&state, "Work");
        let personal_path =
            crate::server::state::profile_json_path(&state, "Personal");
        assert!(!work_path.exists(), "old profile file must be gone");
        assert!(personal_path.exists(), "new profile file must exist");
        let after = tokio::fs::read_to_string(&personal_path).await.unwrap();
        assert_eq!(before, after, "contents preserved byte-for-byte");
    }

    #[tokio::test]
    async fn rename_profile_empty_new_name_returns_400() {
        let state = state_with_profile("tok", vec![]).await;
        crate::server::state::create_profile(&state, "Work", None)
            .await
            .unwrap();
        let app = create_router(state);
        let req = Request::builder()
            .method("PATCH")
            .uri("/api/profiles/Work")
            .header("Content-Type", "application/json")
            .header("X-Panna-CSRF", "tok")
            .extension(axum::extract::ConnectInfo(local_addr()))
            .body(Body::from(r#"{"newName":""}"#))
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), 400);
    }

    // ── Default config + list profiles routes ────────────────────────────

    #[tokio::test]
    async fn get_default_config_returns_default_structure() {
        let state = make_state("tok");
        let app = create_router(state);
        let req = Request::builder()
            .method("GET")
            .uri("/api/config/default")
            .extension(axum::extract::ConnectInfo(local_addr()))
            .body(Body::empty())
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), 200);
        let body = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(json["grid"]["rows"].is_number());
        assert!(json["grid"]["cols"].is_number());
        assert!(json["buttons"].is_array());
    }

    #[tokio::test]
    async fn list_profiles_returns_at_least_default() {
        let state = state_with_profile("tok", vec![]).await;
        let app = create_router(state);
        let req = Request::builder()
            .method("GET")
            .uri("/api/profiles")
            .extension(axum::extract::ConnectInfo(local_addr()))
            .body(Body::empty())
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), 200);
        let body = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(json.is_array());
        assert!(json.as_array().unwrap().iter().any(|p| p["name"] == "Default"));
    }

    // ── PI route success path: serves HTML + injects bridge ──────────────

    async fn state_with_plugin_dir(
        csrf: &str,
        plugin_uuid: &str,
        files: &[(&str, &str)],
    ) -> (Arc<AppState>, tempfile::TempDir) {
        let plugin_dir = tempfile::tempdir().unwrap();
        for (name, content) in files {
            let p = plugin_dir.path().join(name);
            if let Some(parent) = p.parent() {
                tokio::fs::create_dir_all(parent).await.unwrap();
            }
            tokio::fs::write(&p, content).await.unwrap();
        }
        let state = make_state(csrf);
        {
            let mut host = state.plugin_host.lock().await;
            host.plugin_dirs
                .insert(plugin_uuid.to_string(), plugin_dir.path().to_path_buf());
        }
        (state, plugin_dir)
    }

    #[tokio::test]
    async fn pi_route_serves_html_and_injects_bridge_script() {
        let (state, _dir) = state_with_plugin_dir(
            "tok",
            "com.test.plugin",
            &[("pi/index.html", "<html><body><h1>PI</h1></body></html>")],
        )
        .await;
        let app = create_router(state);
        let req = Request::builder()
            .method("GET")
            .uri("/pi/com.test.plugin/pi/index.html")
            .extension(axum::extract::ConnectInfo(local_addr()))
            .body(Body::empty())
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), 200);
        let ct = res
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        assert!(ct.contains("text/html"), "got content-type: {ct}");
        let body = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let html = String::from_utf8_lossy(&body);
        assert!(html.contains("<h1>PI</h1>"), "original content preserved");
        assert!(
            html.contains("connectElgatoStreamDeckSocket"),
            "bridge script injected"
        );
        assert!(html.contains("PI_TOKEN"));
    }

    #[tokio::test]
    async fn pi_route_serves_non_html_without_bridge() {
        let (state, _dir) = state_with_plugin_dir(
            "tok",
            "com.test.plugin",
            &[("style.css", "body{color:red}")],
        )
        .await;
        let app = create_router(state);
        let req = Request::builder()
            .method("GET")
            .uri("/pi/com.test.plugin/style.css")
            .extension(axum::extract::ConnectInfo(local_addr()))
            .body(Body::empty())
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), 200);
        let body = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let s = String::from_utf8_lossy(&body);
        assert_eq!(s, "body{color:red}", "binary/non-html served verbatim");
    }

    #[tokio::test]
    async fn pi_route_stores_token_in_pi_token_map_on_html() {
        let (state, _dir) = state_with_plugin_dir(
            "tok",
            "com.test.plugin",
            &[("pi/index.html", "<html><body></body></html>")],
        )
        .await;
        let app = create_router(state.clone());
        let req = Request::builder()
            .method("GET")
            .uri("/pi/com.test.plugin/pi/index.html")
            .extension(axum::extract::ConnectInfo(local_addr()))
            .body(Body::empty())
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), 200);
        // After response, pi_token_map should have at least one entry pointing to our plugin.
        let host = state.plugin_host.lock().await;
        assert!(
            host.pi_token_map.values().any(|u| u == "com.test.plugin"),
            "PI token must be registered after HTML serve"
        );
    }
}

