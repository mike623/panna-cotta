use mdns_sd::{ServiceDaemon, ServiceInfo};
use std::net::{IpAddr, Ipv4Addr};

/// Advertise the Panna Cotta LAN panel via mDNS/Bonjour.
///
/// Leaks the daemon — it must run for the entire app lifetime.
/// Non-fatal: logs a warning and returns if mDNS is unavailable.
pub fn advertise(port: u16) {
    match try_advertise(port) {
        Ok(daemon) => {
            Box::leak(Box::new(daemon));
        }
        Err(e) => {
            tracing::warn!(error = %e, "mDNS advertisement unavailable");
        }
    }
}

fn try_advertise(port: u16) -> mdns_sd::Result<ServiceDaemon> {
    let daemon = ServiceDaemon::new()?;
    let hostname = local_hostname();
    let ip = local_ipv4();
    let info = ServiceInfo::new(
        "_pannacotta._tcp.local.",
        "Panna Cotta",
        &hostname,
        IpAddr::V4(ip),
        port,
        None,
    )?;
    daemon.register(info)?;
    tracing::info!(hostname = %hostname, port, ip = %ip, "mDNS service advertised");
    Ok(daemon)
}

fn local_hostname() -> String {
    raw_hostname()
        .map(|h| {
            let base = h.split('.').next().unwrap_or(&h).to_lowercase();
            let sanitized: String = base
                .chars()
                .map(|c| if c.is_alphanumeric() || c == '-' { c } else { '-' })
                .collect();
            format!("{sanitized}.local.")
        })
        .unwrap_or_else(|| "panna-cotta.local.".to_string())
}

fn raw_hostname() -> Option<String> {
    // Prefer the macOS Bonjour name so the advertised `.local` record matches
    // what the OS already resolves; `gethostname()` may be a cloud/DHCP FQDN.
    #[cfg(target_os = "macos")]
    {
        if let Some(name) = macos_local_hostname() {
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
                return Some(s.to_string());
            }
        }
    }
    std::env::var("COMPUTERNAME").ok()
}

/// The macOS Bonjour name (`scutil --get LocalHostName`), e.g. `"mikes-Mac-mini"`.
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

/// Determine the outbound LAN IP without sending packets.
fn local_ipv4() -> Ipv4Addr {
    std::net::UdpSocket::bind("0.0.0.0:0")
        .ok()
        .and_then(|s| {
            s.connect("8.8.8.8:80").ok()?;
            s.local_addr().ok()
        })
        .and_then(|addr| match addr.ip() {
            std::net::IpAddr::V4(v4) => Some(v4),
            _ => None,
        })
        .unwrap_or(Ipv4Addr::LOCALHOST)
}
