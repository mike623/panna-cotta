use std::sync::Arc;
use std::time::Duration;
use tauri::State;

use crate::server::state::{AppState, VersionCache, VersionInfo};

const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");
const CACHE_TTL: Duration = Duration::from_secs(3600);
const RELEASES_URL: &str =
    "https://api.github.com/repos/mike623/panna-cotta/releases/latest";

async fn fetch_latest() -> Option<VersionCache> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .ok()?;
    let resp = client
        .get(RELEASES_URL)
        .header("User-Agent", "panna-cotta")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let data: serde_json::Value = resp.json().await.ok()?;
    let tag = data["tag_name"].as_str()?.trim_start_matches('v').to_string();
    let url = data["html_url"]
        .as_str()
        .unwrap_or(RELEASES_URL)
        .to_string();
    Some(VersionCache {
        latest: tag,
        release_url: url,
        fetched_at: std::time::Instant::now(),
    })
}

fn is_newer(latest: &str, current: &str) -> bool {
    match (
        semver::Version::parse(latest),
        semver::Version::parse(current),
    ) {
        (Ok(l), Ok(c)) => l > c,
        _ => latest != current,
    }
}

pub async fn get_version_info_inner(state: &AppState) -> Result<VersionInfo, String> {
    let needs_refresh = {
        let cache = state.version_cache.lock().map_err(|e| e.to_string())?;
        cache
            .as_ref()
            .map_or(true, |c| c.fetched_at.elapsed() > CACHE_TTL)
    };

    if needs_refresh {
        if let Some(fresh) = fetch_latest().await {
            *state.version_cache.lock().map_err(|e| e.to_string())? = Some(fresh);
        }
    }

    let cache = state.version_cache.lock().map_err(|e| e.to_string())?;
    let latest = cache.as_ref().map(|c| c.latest.clone());
    let release_url = cache.as_ref().map(|c| c.release_url.clone());
    let update_available = latest
        .as_deref()
        .map_or(false, |l| is_newer(l, CURRENT_VERSION));

    Ok(VersionInfo {
        current: CURRENT_VERSION.to_string(),
        latest,
        update_available,
        release_url,
    })
}

#[tauri::command]
pub async fn get_version_info(
    state: State<'_, Arc<AppState>>,
) -> Result<VersionInfo, String> {
    get_version_info_inner(&state).await
}
