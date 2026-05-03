pub mod routes;
pub mod state;

use std::sync::Arc;
use tokio::net::TcpListener;
use state::AppState;

const PORT_FILE_NAME: &str = ".panna-cotta.port";

fn port_file() -> std::path::PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    std::path::PathBuf::from(home).join(PORT_FILE_NAME)
}

async fn is_port_free(port: u16) -> bool {
    TcpListener::bind(format!("0.0.0.0:{port}")).await.is_ok()
}

pub async fn resolve_port() -> Result<u16, String> {
    if let Ok(content) = tokio::fs::read_to_string(port_file()).await {
        if let Ok(p) = content.trim().parse::<u16>() {
            if (30000..40000).contains(&p) && is_port_free(p).await {
                return Ok(p);
            }
        }
    }
    for p in 30000u16..40000 {
        if is_port_free(p).await {
            tokio::fs::write(port_file(), p.to_string())
                .await
                .map_err(|e| e.to_string())?;
            return Ok(p);
        }
    }
    Err("No free port found in range 30000–39999".to_string())
}

pub async fn start(state: Arc<AppState>) -> Result<u16, String> {
    let port = resolve_port().await?;
    let router = routes::create_router(state.clone());
    let listener = TcpListener::bind(format!("0.0.0.0:{port}"))
        .await
        .map_err(|e| e.to_string())?;

    *state.port.lock().map_err(|e| e.to_string())? = Some(port);

    tauri::async_runtime::spawn(async move {
        axum::serve(listener, router).await.expect("axum server failed");
    });

    Ok(port)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn resolve_port_finds_free_port() {
        let port = resolve_port().await.unwrap();
        assert!((30000..40000).contains(&port));
    }
}
