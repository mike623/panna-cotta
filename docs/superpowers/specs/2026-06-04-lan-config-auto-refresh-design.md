# LAN Client Auto-Refresh on Config Save

**Date:** 2026-06-04  
**Status:** Approved

## Problem

LAN panel clients (phones/tablets at `/apps/`) fetch config once on page load. When the admin saves a new config or switches profiles, LAN clients display stale buttons until manually refreshed.

## Goal

LAN clients silently re-render their button grid whenever the active config changes — no page reload, no visible disruption.

## Approach

SSE notification + client re-fetch (Option A). A watch channel in `AppState` tracks a version counter. When config changes, the counter bumps. LAN clients subscribe to a new SSE endpoint; on each bump they re-fetch `/api/config` and re-render.

Follows the existing `/api/autocomplete` SSE pattern exactly.

## Backend Changes

### `AppState` (`server/state.rs`)

Add one field:

```rust
pub config_version: Arc<tokio::sync::watch::Sender<u64>>,
```

Initialize in `AppState::new()`:

```rust
let (config_version_tx, _) = tokio::sync::watch::channel(0u64);
let config_version = Arc::new(config_version_tx);
```

### Bump points (`server/state.rs`)

`save_stream_deck_config` — after successful disk write:

```rust
let _ = state.config_version.send_modify(|v| *v += 1);
```

`activate_profile` — after `fire_profile_lifecycle`:

```rust
let _ = state.config_version.send_modify(|v| *v += 1);
```

These two functions cover all four mutation paths that change what LAN sees:
- Admin Tauri IPC `save_config` → `save_stream_deck_config`
- Admin HTTP `PUT /api/config` → `save_stream_deck_config`
- Profile switch → `activate_profile`
- Profile create (route calls `activate_profile` after create)

### New SSE route (`server/routes.rs`)

```rust
async fn config_events_sse_handler(
    State(state): State<Arc<AppState>>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = state.config_version.subscribe();

    let stream = stream::unfold(rx, |mut rx| async move {
        rx.changed().await.ok()?;
        let v = *rx.borrow_and_update();
        let data = serde_json::json!({"v": v}).to_string();
        Some((Ok(Event::default().data(data)), rx))
    });

    Sse::new(stream).keep_alive(axum::response::sse::KeepAlive::default())
}
```

Registered in `create_router` with existing public GET routes (no auth — same access level as `GET /api/config`):

```rust
.route("/api/config/events", get(config_events_sse_handler))
```

## Frontend Changes (`packages/frontend/app.js`)

New function, mirrors `startAutocompleteSSE`:

```js
let configEventsSource = null;

function startConfigEvents() {
  if (configEventsSource) configEventsSource.close();
  configEventsSource = new EventSource(`${api.baseUrl}/api/config/events`);

  configEventsSource.onmessage = async () => {
    try {
      config = await api.getConfig();
      renderView();
    } catch (_) {}
  };

  configEventsSource.onerror = () => {
    configEventsSource.close();
    configEventsSource = null;
    setTimeout(startConfigEvents, 3000);
  };
}
```

Called in `DOMContentLoaded` after initial `renderView()`:

```js
startConfigEvents();
```

## Behaviour Notes

- **Silent**: no toast or indicator — grid updates in place
- **`currentPage` preserved**: re-render stays on current page (user mid-swipe unaffected)
- **Re-fetch race safety**: ignores `v` payload, always fetches latest — rapid saves produce one final fetch, not buffered intermediates
- **Disconnect resilience**: on SSE error, 3s backoff then reconnect (same as autocomplete); health ping separately handles offline banner
- **No initial event**: SSE handler does NOT emit on connect — only emits when version actually changes. Client subscribes and waits silently until a save occurs.

## Test Coverage

- Unit: `save_stream_deck_config` bumps `config_version` watch sender
- Unit: `activate_profile` bumps `config_version` watch sender  
- Integration: `GET /api/config/events` returns `200 text/event-stream`
- E2E (existing Playwright suite): admin saves config → LAN panel re-renders without reload
