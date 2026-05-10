use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, FromRequestParts, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use futures_util::sink::SinkExt;
use futures_util::stream::StreamExt;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use crate::server::routes::is_localhost_addr;
use crate::server::state::AppState;
use crate::plugin::{PluginStatus, CHANNEL_CAPACITY, PENDING_REGISTRATION_TIMEOUT_SECS, WS_AUTH_TIMEOUT_SECS};

fn extract_token(query: Option<&str>) -> Option<String> {
    query?.split('&')
        .find(|part| part.starts_with("token="))
        .map(|part| part["token=".len()..].to_string())
}

pub async fn ws_upgrade(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    req: axum::extract::Request,
) -> impl IntoResponse {
    // Phase A: ConnectInfo check — before any WS upgrade
    if !is_localhost_addr(&addr) {
        return StatusCode::FORBIDDEN.into_response();
    }

    let port = state.port.lock().ok().and_then(|g| *g).unwrap_or(0);
    let pi_origin = format!("http://127.0.0.1:{port}");
    let origin = headers.get("Origin")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    // No Origin = native process. Wrong origin (not PI) = reject.
    if !origin.is_empty() && origin != pi_origin {
        return StatusCode::FORBIDDEN.into_response();
    }

    let is_pi = !origin.is_empty();
    let pi_token = extract_token(req.uri().query());

    // Now attempt WS upgrade extraction from the request parts
    let (mut parts, _body) = req.into_parts();
    let ws = match WebSocketUpgrade::from_request_parts(&mut parts, &state).await {
        Ok(ws) => ws,
        Err(rejection) => return rejection.into_response(),
    };

    ws.on_upgrade(move |socket| handle_ws(socket, state, is_pi, pi_token)).into_response()
}

async fn handle_ws(mut socket: WebSocket, state: Arc<AppState>, is_pi: bool, _pi_token: Option<String>) {
    let auth_timeout = Duration::from_secs(WS_AUTH_TIMEOUT_SECS);

    // Phase B: wait for first message within auth_timeout
    let first = tokio::time::timeout(auth_timeout, socket.recv()).await;
    let text = match first {
        Ok(Some(Ok(Message::Text(t)))) => t,
        _ => return, // timeout, close frame, or binary
    };

    let msg: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return,
    };

    let event = msg.get("event").and_then(|v| v.as_str()).unwrap_or("");

    if is_pi && event == "registerPropertyInspector" {
        // PI registration — full impl in Plan 2
        tracing::debug!("PI registration stub");
        return;
    }

    if !is_pi && event == "registerPlugin" {
        handle_plugin_registration(msg, socket, state).await;
    }
}

async fn handle_plugin_registration(
    first_msg: serde_json::Value,
    socket: WebSocket,
    state: Arc<AppState>,
) {
    let uuid = match first_msg.get("uuid").and_then(|v| v.as_str()) {
        Some(u) => u.to_string(),
        None => return,
    };

    // Validate: uuid must be in pending_registrations and within timeout window
    let valid = {
        let host = state.plugin_host.lock().await;
        let timeout = Duration::from_secs(PENDING_REGISTRATION_TIMEOUT_SECS);
        host.pending_registrations.get(&uuid)
            .map(|&spawn_time| spawn_time.elapsed() < timeout)
            .unwrap_or(false)
    };

    if !valid {
        tracing::warn!(uuid = %uuid, "WS: unknown or expired plugin UUID rejected");
        return;
    }

    let (tx, mut rx) = tokio::sync::mpsc::channel::<serde_json::Value>(CHANNEL_CAPACITY);

    // Register: move from pending to running, set sender
    let queued: Vec<serde_json::Value> = {
        let mut host = state.plugin_host.lock().await;
        host.pending_registrations.remove(&uuid);
        if let Some(ps) = host.plugins.get_mut(&uuid) {
            ps.sender = Some(tx.clone());
            ps.status = PluginStatus::Running;
            ps.pre_reg_queue.drain(..).collect()
        } else {
            vec![]
        }
    };

    tracing::info!(uuid = %uuid, "plugin registered via WS");

    // Fire startup lifecycle events first (lock order: PluginHost → profile_state)
    {
        let host = state.plugin_host.lock().await;
        let ps = host.profile_state.lock().await;
        let cols = ps.grid.cols;
        let rows = ps.grid.rows;

        // deviceDidConnect must precede willAppear (Elgato protocol ordering)
        if tx.try_send(crate::events::outbound::device_did_connect(cols, rows)).is_err() {
            tracing::warn!(uuid = %uuid, "deviceDidConnect dropped: channel full at registration");
        }

        for (idx, btn) in ps.buttons.iter().enumerate() {
            if host.registry.get(&btn.action_uuid).map(|u| u == &uuid).unwrap_or(false) {
                let msg = crate::events::outbound::will_appear(
                    &btn.action_uuid, &btn.context, &btn.settings, idx, cols,
                );
                if tx.try_send(msg).is_err() {
                    tracing::warn!(uuid = %uuid, idx = idx, "willAppear dropped: channel full at registration");
                }
            }
        }
    }

    // Flush pre-reg queue after lifecycle events
    for msg in queued {
        let _ = tx.try_send(msg);
    }

    // Split the socket into sender/receiver halves
    let (mut ws_tx, mut ws_rx) = socket.split();

    // WS sender task: drain mpsc channel → WebSocket
    let sender_uuid = uuid.clone();
    let sender_state = state.clone();
    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            let text = serde_json::to_string(&msg).unwrap_or_default();
            if ws_tx.send(Message::Text(text)).await.is_err() {
                break;
            }
        }
        // Channel closed or WS error — mark sender as gone
        let mut host = sender_state.plugin_host.lock().await;
        if let Some(ps) = host.plugins.get_mut(&sender_uuid) {
            if ps.status == PluginStatus::Running {
                ps.status = PluginStatus::Starting;
                ps.sender = None;
            }
        }
    });

    // Receive loop: dispatch inbound plugin→host messages
    let recv_uuid = uuid.clone();
    while let Some(Ok(Message::Text(text))) = ws_rx.next().await {
        if let Ok(msg) = serde_json::from_str::<serde_json::Value>(&text) {
            crate::events::inbound::dispatch(msg, &recv_uuid, &state).await;
        }
    }

    // Plugin disconnected
    {
        let mut host = state.plugin_host.lock().await;
        if let Some(ps) = host.plugins.get_mut(&uuid) {
            ps.sender = None;
        }
    }
    tracing::info!(uuid = %uuid, "plugin WS disconnected");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_token_from_query_string() {
        assert_eq!(extract_token(Some("token=abc123")), Some("abc123".into()));
        assert_eq!(extract_token(Some("foo=bar&token=xyz&baz=1")), Some("xyz".into()));
        assert_eq!(extract_token(Some("foo=bar")), None);
        assert_eq!(extract_token(None), None);
    }
}
