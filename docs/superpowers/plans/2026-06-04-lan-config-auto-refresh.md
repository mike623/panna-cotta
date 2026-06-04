# LAN Client Auto-Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LAN panel clients (phones/tablets) silently re-render their button grid when the admin saves a config or switches profiles, with no page reload.

**Architecture:** A `tokio::sync::watch` channel in `AppState` tracks a u64 version counter. Two mutation functions (`save_stream_deck_config`, `activate_profile`) bump the counter on success. A new SSE endpoint `/api/config/events` streams version bumps to connected LAN clients. On each bump, the client re-fetches `/api/config` and re-renders — following the identical pattern already used for `/api/autocomplete`.

**Tech Stack:** Rust/Axum (backend), `tokio::sync::watch`, `futures_util::stream::unfold`, plain JS `EventSource` (frontend).

---

## File Map

| File | Change |
|------|--------|
| `packages/desktop/src-tauri/src/server/state.rs` | Add `config_version` field to `AppState`; init in `new()`; bump in `save_stream_deck_config` and `activate_profile`; update `temp_state()` test helper |
| `packages/desktop/src-tauri/src/server/routes.rs` | Add `config_events_sse_handler`; register `/api/config/events` route; update `make_state()` and `state_with_profile()` test helpers |
| `packages/frontend/app.js` | Add `startConfigEvents()` function; call it in `DOMContentLoaded` |

---

### Task 1: Add `config_version` watch channel to `AppState`

**Files:**
- Modify: `packages/desktop/src-tauri/src/server/state.rs`

- [ ] **Step 1: Write failing test**

Add to the `#[cfg(test)]` module at the bottom of `server/state.rs`:

```rust
#[tokio::test]
async fn config_version_starts_at_zero() {
    let state = AppState::new();
    let rx = state.config_version.subscribe();
    assert_eq!(*rx.borrow(), 0u64);
}
```

- [ ] **Step 2: Run — confirm compile error (field doesn't exist yet)**

```bash
cd packages/desktop/src-tauri && cargo test config_version_starts_at_zero 2>&1 | head -20
```

Expected: compile error mentioning unknown field `config_version`.

- [ ] **Step 3: Add field to `AppState` struct**

In `server/state.rs`, find the `AppState` struct (currently ends with `autocomplete` field). Add the new field:

```rust
pub struct AppState {
    pub config_dir: PathBuf,
    pub port: Mutex<Option<u16>>,
    pub csrf_token: String,
    pub plugin_host: Arc<tokio::sync::Mutex<crate::plugin::PluginHost>>,
    pub plugin_render: Arc<Mutex<PluginRenderState>>,
    pub app_handle: Mutex<Option<tauri::AppHandle>>,
    pub autocomplete: Arc<crate::autocomplete::state::AutocompleteState>,
    pub config_version: Arc<tokio::sync::watch::Sender<u64>>,
}
```

- [ ] **Step 4: Initialize field in `AppState::new()`**

In `AppState::new()`, add before the `Self { ... }` block:

```rust
let (config_version_tx, _) = tokio::sync::watch::channel(0u64);
let config_version = Arc::new(config_version_tx);
```

And add to the `Self { ... }` struct literal:

```rust
Self {
    config_dir,
    port: Mutex::new(None),
    csrf_token,
    plugin_host,
    plugin_render,
    app_handle: Mutex::new(None),
    autocomplete,
    config_version,
}
```

- [ ] **Step 5: Update `temp_state()` test helper**

In the `#[cfg(test)]` module, find `fn temp_state()`. Add before the `AppState { ... }` literal:

```rust
let (config_version_tx, _) = tokio::sync::watch::channel(0u64);
```

Add field to the struct literal:

```rust
let state = AppState {
    config_dir: dir.path().to_path_buf(),
    port: std::sync::Mutex::new(None),
    csrf_token: "test_csrf_token_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into(),
    plugin_host,
    plugin_render,
    app_handle: std::sync::Mutex::new(None),
    autocomplete: Arc::new(crate::autocomplete::state::AutocompleteState::new(
        crate::autocomplete::state::AutocompleteConfig::default(),
    )),
    config_version: Arc::new(config_version_tx),
};
```

- [ ] **Step 6: Run test — confirm passes**

```bash
cd packages/desktop/src-tauri && cargo test config_version_starts_at_zero -- --nocapture
```

Expected: `test server::state::tests::config_version_starts_at_zero ... ok`

- [ ] **Step 7: Run full test suite — confirm no regressions**

```bash
cd packages/desktop/src-tauri && cargo test 2>&1 | tail -20
```

Expected: all existing tests pass (the struct literal changes in `temp_state` fix any compile errors).

- [ ] **Step 8: Commit**

```bash
git add packages/desktop/src-tauri/src/server/state.rs
git commit -m "feat(state): add config_version watch channel to AppState"
```

---

### Task 2: Bump version counter on config save

**Files:**
- Modify: `packages/desktop/src-tauri/src/server/state.rs`

- [ ] **Step 1: Write failing test**

Add to `#[cfg(test)]` module in `server/state.rs`:

```rust
#[tokio::test]
async fn save_config_bumps_version() {
    let (state, _dir) = temp_state();
    migrate_old_config(&state).await.unwrap();
    let mut rx = state.config_version.subscribe();
    let before = *rx.borrow();
    let cfg = default_config();
    save_stream_deck_config(&state, &cfg).await.unwrap();
    assert!(rx.has_changed().unwrap(), "version must have changed");
    assert_eq!(*rx.borrow_and_update(), before + 1);
}
```

- [ ] **Step 2: Run — confirm fails**

```bash
cd packages/desktop/src-tauri && cargo test save_config_bumps_version -- --nocapture
```

Expected: `FAILED` — assertion `version must have changed` fires.

- [ ] **Step 3: Add bump to `save_stream_deck_config`**

In `server/state.rs`, find `save_stream_deck_config`. The end of the function looks like:

```rust
    let result = write_json_atomic(&profile_json_path(state, &active), config).await;
    if result.is_ok() {
        tracing::info!(profile = %active, "config saved");
    }
    result
```

Change to:

```rust
    let result = write_json_atomic(&profile_json_path(state, &active), config).await;
    if result.is_ok() {
        tracing::info!(profile = %active, "config saved");
        let _ = state.config_version.send_modify(|v| *v += 1);
    }
    result
```

- [ ] **Step 4: Run test — confirm passes**

```bash
cd packages/desktop/src-tauri && cargo test save_config_bumps_version -- --nocapture
```

Expected: `test server::state::tests::save_config_bumps_version ... ok`

- [ ] **Step 5: Run full suite**

```bash
cd packages/desktop/src-tauri && cargo test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src-tauri/src/server/state.rs
git commit -m "feat(state): bump config_version on save"
```

---

### Task 3: Bump version counter on profile activate

**Files:**
- Modify: `packages/desktop/src-tauri/src/server/state.rs`

- [ ] **Step 1: Write failing test**

Add to `#[cfg(test)]` module in `server/state.rs`:

```rust
#[tokio::test]
async fn activate_profile_bumps_version() {
    let (state, _dir) = temp_state();
    create_profile(&state, "Work", None).await.unwrap();
    let mut rx = state.config_version.subscribe();
    activate_profile(&state, "Work").await.unwrap();
    assert!(rx.has_changed().unwrap(), "version must have changed after activate");
}
```

- [ ] **Step 2: Run — confirm fails**

```bash
cd packages/desktop/src-tauri && cargo test activate_profile_bumps_version -- --nocapture
```

Expected: `FAILED` — assertion fires.

- [ ] **Step 3: Add bump to `activate_profile`**

In `server/state.rs`, find `activate_profile`. The end of the function looks like:

```rust
    let mut host = state.plugin_host.lock().await;
    host.fire_profile_lifecycle(new_config).await;
    drop(host);
    tracing::info!(profile = %safe, "profile activated");
    Ok(())
```

Change to:

```rust
    let mut host = state.plugin_host.lock().await;
    host.fire_profile_lifecycle(new_config).await;
    drop(host);
    let _ = state.config_version.send_modify(|v| *v += 1);
    tracing::info!(profile = %safe, "profile activated");
    Ok(())
```

- [ ] **Step 4: Run test — confirm passes**

```bash
cd packages/desktop/src-tauri && cargo test activate_profile_bumps_version -- --nocapture
```

Expected: `test server::state::tests::activate_profile_bumps_version ... ok`

- [ ] **Step 5: Run full suite**

```bash
cd packages/desktop/src-tauri && cargo test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src-tauri/src/server/state.rs
git commit -m "feat(state): bump config_version on profile activate"
```

---

### Task 4: Add `/api/config/events` SSE route

**Files:**
- Modify: `packages/desktop/src-tauri/src/server/routes.rs`

- [ ] **Step 1: Update `make_state()` test helper in routes.rs**

In `server/routes.rs`, find `fn make_state(csrf: &str) -> Arc<AppState>`. Add before the `Arc::new(AppState { ... })` call:

```rust
let (config_version_tx, _) = tokio::sync::watch::channel(0u64);
```

Add field to the struct literal inside `Arc::new(AppState { ... })`:

```rust
Arc::new(AppState {
    config_dir: PathBuf::from("/tmp/test-panna"),
    port: Mutex::new(None),
    csrf_token: csrf.to_string(),
    plugin_host,
    plugin_render,
    app_handle: Mutex::new(None),
    autocomplete: std::sync::Arc::new(crate::autocomplete::state::AutocompleteState::new(
        crate::autocomplete::state::AutocompleteConfig::default(),
    )),
    config_version: std::sync::Arc::new(config_version_tx),
})
```

- [ ] **Step 2: Update `state_with_profile()` test helper in routes.rs**

In `server/routes.rs`, find `async fn state_with_profile(csrf: &str, buttons: ...)`. Add before the `Arc::new(AppState { ... })` call:

```rust
let (config_version_tx, _) = tokio::sync::watch::channel(0u64);
```

Add field to the struct literal:

```rust
Arc::new(AppState {
    config_dir: dir_path,
    port: std::sync::Mutex::new(None),
    csrf_token: csrf.to_string(),
    plugin_host,
    plugin_render,
    app_handle: std::sync::Mutex::new(None),
    autocomplete: std::sync::Arc::new(crate::autocomplete::state::AutocompleteState::new(
        crate::autocomplete::state::AutocompleteConfig::default(),
    )),
    config_version: std::sync::Arc::new(config_version_tx),
})
```

- [ ] **Step 3: Confirm existing tests still compile**

```bash
cd packages/desktop/src-tauri && cargo check 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 4: Write failing test**

Add to `#[cfg(test)]` module in `server/routes.rs`:

```rust
#[tokio::test]
async fn config_events_returns_sse() {
    let state = make_state("tok");
    let app = create_router(state);
    let req = Request::builder()
        .method("GET")
        .uri("/api/config/events")
        .extension(axum::extract::ConnectInfo(lan_addr()))
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(
        res.headers().get("content-type").and_then(|v| v.to_str().ok()),
        Some("text/event-stream")
    );
}
```

- [ ] **Step 5: Run — confirm fails**

```bash
cd packages/desktop/src-tauri && cargo test config_events_returns_sse -- --nocapture
```

Expected: `FAILED` — route doesn't exist yet, likely 404.

- [ ] **Step 6: Add SSE handler**

In `server/routes.rs`, add the handler function after `autocomplete_sse_handler`:

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

- [ ] **Step 7: Register the route**

In `create_router`, find the line:

```rust
.route("/api/autocomplete", get(autocomplete_sse_handler))
```

Add the new route immediately after it:

```rust
.route("/api/config/events", get(config_events_sse_handler))
```

- [ ] **Step 8: Run test — confirm passes**

```bash
cd packages/desktop/src-tauri && cargo test config_events_returns_sse -- --nocapture
```

Expected: `test server::routes::tests::config_events_returns_sse ... ok`

- [ ] **Step 9: Run full suite**

```bash
cd packages/desktop/src-tauri && cargo test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add packages/desktop/src-tauri/src/server/routes.rs
git commit -m "feat(routes): add /api/config/events SSE endpoint"
```

---

### Task 5: Frontend — subscribe and re-render on config change

**Files:**
- Modify: `packages/frontend/app.js`

- [ ] **Step 1: Add `startConfigEvents` function**

In `packages/frontend/app.js`, find `startAutocompleteSSE`. Add the following function immediately before it:

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

- [ ] **Step 2: Call `startConfigEvents` in `DOMContentLoaded`**

In the `DOMContentLoaded` handler, find the line:

```js
startAutocompleteSSE();
```

Add `startConfigEvents()` immediately before it:

```js
startConfigEvents();
startAutocompleteSSE();
```

- [ ] **Step 3: Build frontend to confirm no syntax errors**

```bash
cd packages/desktop && npm run build 2>&1 | tail -10
```

Expected: build succeeds with no errors.

- [ ] **Step 4: Manual smoke test**

```bash
cd packages/desktop && npm run tauri dev
```

1. Open LAN panel in a browser: `http://localhost:<PORT>/apps/`
2. Open admin UI: the Tauri window
3. In admin, rename a button or change its icon and save
4. Confirm: LAN panel button updates within ~1 second, no page reload, no flash

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/app.js
git commit -m "feat(lan): auto-refresh on config save via SSE"
```

---

## Final Verification

- [ ] **Run full Rust test suite**

```bash
cd packages/desktop/src-tauri && cargo test 2>&1 | tail -15
```

Expected: all tests pass including the 3 new tests (`config_version_starts_at_zero`, `save_config_bumps_version`, `activate_profile_bumps_version`, `config_events_returns_sse`).

- [ ] **Run clippy**

```bash
cd packages/desktop/src-tauri && cargo clippy 2>&1 | grep -E "^error" | head -10
```

Expected: no errors.

- [ ] **Run Svelte build**

```bash
cd packages/desktop && npm run build 2>&1 | tail -5
```

Expected: clean build.
