use std::net::UdpSocket;
use std::sync::Arc;
use serde::Serialize;
use tauri::State;

use crate::server::state::AppState;

#[derive(Serialize)]
pub struct ServerInfo {
    pub ip: String,
    pub port: u16,
}

fn local_ip() -> String {
    UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| {
            s.connect("8.8.8.8:80")?;
            s.local_addr()
        })
        .map(|a| a.ip().to_string())
        .unwrap_or_else(|_| "localhost".to_string())
}

#[tauri::command]
pub fn get_server_info(state: State<'_, Arc<AppState>>) -> Result<ServerInfo, String> {
    let port = state
        .port
        .lock()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Server not started".to_string())?;
    Ok(ServerInfo {
        ip: local_ip(),
        port,
    })
}
