use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Json, Redirect, Response},
    routing::{get, patch, post},
    Router,
};
use include_dir::{include_dir, Dir};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

use crate::server::state::{
    activate_profile, create_profile, default_config, delete_profile,
    list_profiles, rename_profile, save_stream_deck_config,
    use_stream_deck_config, AppState, StreamDeckConfig,
};
use crate::commands::version::get_version_info_inner;

static APPS_DIR: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../../frontend");

pub fn create_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/", get(qr_page))
        .route("/apps", get(|| async { Redirect::permanent("/apps/") }))
        .route("/apps/", get(serve_apps_index))
        .route("/apps/*path", get(serve_apps_file))
        .route("/api/health", get(|| async { "OK" }))
        .route("/api/config", get(get_config).put(put_config))
        .route("/api/config/default", get(get_default_config_handler))
        .route("/api/profiles", get(list_profiles_handler).post(create_profile_handler))
        .route("/api/profiles/:name/activate", post(activate_profile_handler))
        .route("/api/profiles/:name", patch(rename_profile_handler).delete(delete_profile_handler))
        .route("/api/execute", post(execute_handler))
        .route("/api/open-app", post(open_app_handler))
        .route("/api/open-url", post(open_url_handler))
        .route("/api/open-config-folder", post(open_config_folder_handler))
        .route("/api/version", get(version_handler))
        .route("/api/check-update", get(check_update_handler))
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

async fn get_config(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match use_stream_deck_config(&state).await {
        Ok(cfg) => (StatusCode::OK, Json(json!(cfg))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))).into_response(),
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
    match create_profile(&state, &name, None).await
        .and(activate_profile(&state, &name).await)
    {
        Ok(_) => Json(json!({"ok": true, "name": name})).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({"error": e}))).into_response(),
    }
}

async fn activate_profile_handler(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let name = urlencoding::decode(&name).unwrap_or_default().into_owned();
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
    let old = urlencoding::decode(&name).unwrap_or_default().into_owned();
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
    let name = urlencoding::decode(&name).unwrap_or_default().into_owned();
    match delete_profile(&state, &name).await {
        Ok(_) => Json(json!({"ok": true})).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({"error": e}))).into_response(),
    }
}

// ── System handlers ───────────────────────────────────────────────────

#[derive(Deserialize)]
struct ExecuteBody { action: String, target: String }

async fn execute_handler(Json(body): Json<ExecuteBody>) -> impl IntoResponse {
    match crate::commands::system::execute_command(body.action, body.target).await {
        Ok(_) => Json(json!({"success": true})).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"success": false, "message": e}))).into_response(),
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

// ── Version handlers ──────────────────────────────────────────────────

async fn version_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match get_version_info_inner(&state).await {
        Ok(v) => Json(json!(v)).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))).into_response(),
    }
}

async fn check_update_handler() -> impl IntoResponse {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))).into_response(),
    };
    let url = "https://api.github.com/repos/mike623/panna-cotta/releases/latest";
    match client.get(url).header("User-Agent", "panna-cotta").send().await {
        Ok(r) if r.status().is_success() => {
            match r.json::<Value>().await {
                Ok(data) => Json(json!({
                    "version": data["tag_name"],
                    "name": data["name"],
                    "url": data["html_url"],
                    "assets": data["assets"].as_array().unwrap_or(&vec![]).iter().map(|a| json!({"name": a["name"], "url": a["browser_download_url"]})).collect::<Vec<_>>()
                })).into_response(),
                Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))).into_response(),
            }
        }
        _ => (StatusCode::BAD_GATEWAY, Json(json!({"error": "GitHub API error"}))).into_response(),
    }
}
