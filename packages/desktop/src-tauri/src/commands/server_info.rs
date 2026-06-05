use std::net::UdpSocket;
use std::sync::Arc;
use serde::Serialize;
use tauri::State;

use crate::server::state::AppState;

#[derive(Serialize)]
pub struct ServerInfo {
    pub ip: String,
    pub port: u16,
    /// mDNS hostname (without `.local` suffix) when resolvable, e.g. `"mikes-mac"`.
    /// Lets the admin UI offer a `http://<hostname>.local:<port>/` URL that
    /// survives DHCP lease changes, falling back to the raw IP when absent.
    pub hostname: Option<String>,
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

/// Sanitized short hostname (no domain, no `.local`), matching the value the
/// mDNS responder advertises. None when the OS hostname can't be read.
fn local_hostname() -> Option<String> {
    // On macOS the Bonjour name (`scutil --get LocalHostName`) is what the OS
    // actually resolves over mDNS — `gethostname()` can return an unrelated
    // FQDN (e.g. a cloud/DHCP-assigned `ip-x-x-x-x.compute.internal`) that has
    // no `.local` A-record. Prefer the Bonjour name.
    #[cfg(target_os = "macos")]
    {
        if let Some(name) = macos_local_hostname().and_then(|s| sanitize_hostname(&s)) {
            return Some(name);
        }
    }
    #[cfg(unix)]
    {
        let mut buf = [0u8; 256];
        let rc = unsafe {
            libc::gethostname(buf.as_mut_ptr() as *mut libc::c_char, buf.len())
        };
        if rc == 0 {
            let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
            if let Ok(s) = std::str::from_utf8(&buf[..end]) {
                return sanitize_hostname(s);
            }
        }
    }
    std::env::var("COMPUTERNAME").ok().and_then(|s| sanitize_hostname(&s))
}

/// The macOS Bonjour name (`LocalHostName`), e.g. `"mikes-Mac-mini"`, which the
/// system mDNS responder advertises as `<name>.local`. None if unreadable.
#[cfg(target_os = "macos")]
fn macos_local_hostname() -> Option<String> {
    let out = std::process::Command::new("scutil")
        .args(["--get", "LocalHostName"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let name = String::from_utf8(out.stdout).ok()?.trim().to_string();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

fn sanitize_hostname(raw: &str) -> Option<String> {
    let base = raw.split('.').next().unwrap_or(raw).to_lowercase();
    let sanitized: String = base
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' { c } else { '-' })
        .collect();
    if sanitized.is_empty() {
        None
    } else {
        Some(sanitized)
    }
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
        hostname: local_hostname(),
    })
}
