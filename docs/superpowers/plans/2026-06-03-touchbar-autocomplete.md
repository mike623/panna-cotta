# Touch Bar Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent word-suggestion strip to the Panna Cotta LAN panel that mimics the MacBook Touch Bar autocomplete row — monitors global keystrokes on macOS, surfaces word completions, and lets the user tap to insert or long-press to copy.

**Architecture:** A new `autocomplete` Rust module monitors global keystrokes via `rdev::listen` (macOS only), builds a word buffer, looks up prefix completions from `/usr/share/dict/words`, and broadcasts suggestions via a `tokio::sync::watch` channel. Axum exposes a `GET /api/autocomplete` SSE endpoint that streams changes to the LAN panel. The panel renders a persistent chip strip below the grid; tap sends keystroke completion via `POST /api/execute`, long-press copies to clipboard.

**Tech Stack:** Rust (rdev 0.5, tokio::sync::watch, futures-util), Axum 0.7 SSE, vanilla JS (LAN panel), React/TSX (admin settings), Tauri commands.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src-tauri/src/autocomplete/mod.rs` | Module re-exports |
| Create | `src-tauri/src/autocomplete/state.rs` | `AutocompleteConfig`, `AutocompleteState`, watch channel |
| Create | `src-tauri/src/autocomplete/buffer.rs` | `WordBuffer` — boundary detection, partial word tracking |
| Create | `src-tauri/src/autocomplete/spell.rs` | Dictionary completions from `/usr/share/dict/words` |
| Create | `src-tauri/src/autocomplete/tap.rs` | `start_monitor` — rdev keyboard listener thread |
| Create | `src-tauri/src/commands/autocomplete.rs` | Tauri commands: get/set config, accessibility status |
| Modify | `src-tauri/src/commands/mod.rs` | Add `pub mod autocomplete` |
| Modify | `src-tauri/src/lib.rs` | Add `pub mod autocomplete` |
| Modify | `src-tauri/src/server/state.rs` | Add `autocomplete: Arc<AutocompleteState>` to `AppState` |
| Modify | `src-tauri/src/server/routes.rs` | Add `GET /api/autocomplete` SSE + extend execute handler |
| Modify | `src-tauri/src/commands/system.rs` | Add `type_text`, `set_clipboard` |
| Modify | `src-tauri/src/app.rs` | Register new commands, start monitor at setup |
| Modify | `src-tauri/Cargo.toml` | Add `rdev` (macOS target) |
| Modify | `packages/frontend/app.js` | Suggestion strip render + SSE + tap/long-press |
| Modify | `packages/frontend/style.css` | Strip + chip styles |
| Create | `packages/desktop/src/AutocompleteSettings.tsx` | Admin UI settings panel |
| Modify | `packages/desktop/src/lib/invoke.ts` | Add autocomplete invoke wrappers |
| Modify | `packages/desktop/src/PannaApp.tsx` | Wire in `AutocompleteSettings` |

---

## Task 1: Cargo.toml + AutocompleteConfig + AutocompleteState

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/autocomplete/mod.rs`
- Create: `src-tauri/src/autocomplete/state.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add rdev dependency (macOS-only)**

In `src-tauri/Cargo.toml`, add after the existing `[target.'cfg(unix)'.dependencies]` block:

```toml
[target.'cfg(target_os = "macos")'.dependencies]
rdev = "0.5"
```

- [ ] **Step 2: Create autocomplete module**

Create `src-tauri/src/autocomplete/mod.rs`:

```rust
pub mod buffer;
pub mod spell;
pub mod state;

#[cfg(target_os = "macos")]
pub mod tap;

pub use state::{AutocompleteConfig, AutocompleteState};
```

- [ ] **Step 3: Create AutocompleteConfig and AutocompleteState**

Create `src-tauri/src/autocomplete/state.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::watch;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutocompleteConfig {
    pub enabled: bool,
    pub suggestion_count: usize,
    pub fallback_phrases: Vec<String>,
}

impl Default for AutocompleteConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            suggestion_count: 3,
            fallback_phrases: vec![
                "Thanks".into(),
                "On my way".into(),
                "👍".into(),
            ],
        }
    }
}

pub struct AutocompleteState {
    pub config: Mutex<AutocompleteConfig>,
    pub last_keystroke: Mutex<Instant>,
    suggestions_tx: watch::Sender<Vec<String>>,
    pub suggestions_rx: watch::Receiver<Vec<String>>,
}

impl AutocompleteState {
    pub fn new(config: AutocompleteConfig) -> Self {
        let fallback = config.fallback_phrases.clone();
        let (tx, rx) = watch::channel(fallback);
        Self {
            config: Mutex::new(config),
            last_keystroke: Mutex::new(Instant::now()),
            suggestions_tx: tx,
            suggestions_rx: rx,
        }
    }

    pub fn set_suggestions(&self, words: Vec<String>) {
        *self.last_keystroke.lock().unwrap() = Instant::now();
        let _ = self.suggestions_tx.send(words);
    }

    pub fn reset_to_fallback(&self) {
        let fallback = self.config.lock().unwrap().fallback_phrases.clone();
        let _ = self.suggestions_tx.send(fallback);
    }

    pub fn is_enabled(&self) -> bool {
        self.config.lock().unwrap().enabled
    }
}
```

- [ ] **Step 4: Register module in lib.rs**

In `src-tauri/src/lib.rs`, add:

```rust
pub mod autocomplete;
pub mod app;
pub mod commands;
pub mod events;
pub mod plugin;
pub mod server;
```

- [ ] **Step 5: Verify it compiles**

```bash
cd packages/desktop/src-tauri && cargo check 2>&1 | grep -E "^error" | head -20
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src-tauri/Cargo.toml \
        packages/desktop/src-tauri/src/autocomplete/mod.rs \
        packages/desktop/src-tauri/src/autocomplete/state.rs \
        packages/desktop/src-tauri/src/lib.rs
git commit -m "feat: autocomplete module skeleton with config and state"
```

---

## Task 2: WordBuffer

**Files:**
- Create: `src-tauri/src/autocomplete/buffer.rs`

- [ ] **Step 1: Write failing tests**

Create `src-tauri/src/autocomplete/buffer.rs` with tests only first:

```rust
pub struct WordBuffer {
    chars: Vec<char>,
}

impl WordBuffer {
    pub fn new() -> Self { Self { chars: Vec::new() } }
    pub fn push(&mut self, ch: char) -> bool { todo!() }
    pub fn current(&self) -> String { todo!() }
    pub fn completion_suffix(&self, full_word: &str) -> String { todo!() }
    pub fn clear(&mut self) { self.chars.clear(); }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_accumulates_chars() {
        let mut b = WordBuffer::new();
        b.push('h'); b.push('e'); b.push('l');
        assert_eq!(b.current(), "hel");
    }

    #[test]
    fn test_space_is_boundary() {
        let mut b = WordBuffer::new();
        b.push('h'); b.push('i');
        let was_boundary = b.push(' ');
        assert!(was_boundary);
        assert_eq!(b.current(), "");
    }

    #[test]
    fn test_punctuation_is_boundary() {
        let mut b = WordBuffer::new();
        b.push('h'); b.push('i');
        let was_boundary = b.push('.');
        assert!(was_boundary);
        assert_eq!(b.current(), "");
    }

    #[test]
    fn test_backspace_removes_last() {
        let mut b = WordBuffer::new();
        b.push('h'); b.push('e'); b.push('l');
        b.push('\x08'); // backspace
        assert_eq!(b.current(), "he");
    }

    #[test]
    fn test_backspace_not_boundary() {
        let mut b = WordBuffer::new();
        b.push('h');
        let was_boundary = b.push('\x08');
        assert!(!was_boundary);
    }

    #[test]
    fn test_completion_suffix() {
        let mut b = WordBuffer::new();
        b.push('h'); b.push('e'); b.push('l');
        assert_eq!(b.completion_suffix("hello"), "lo");
    }

    #[test]
    fn test_completion_suffix_full_word_if_no_match() {
        let mut b = WordBuffer::new();
        b.push('x'); b.push('y'); b.push('z');
        assert_eq!(b.completion_suffix("hello"), "hello");
    }
}
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd packages/desktop/src-tauri && cargo test autocomplete::buffer 2>&1 | tail -10
```

Expected: FAILED — `todo!()` panics.

- [ ] **Step 3: Implement WordBuffer**

Replace the todo stubs with real implementations in `buffer.rs`:

```rust
const BOUNDARIES: &[char] = &[
    ' ', '\t', '\n', '\r', '.', ',', '!', '?', ';', ':', '(', ')',
    '[', ']', '{', '}', '"', '\u{201c}', '\u{201d}',
];

impl WordBuffer {
    pub fn new() -> Self { Self { chars: Vec::new() } }

    /// Returns true if ch was a word boundary (buffer cleared).
    pub fn push(&mut self, ch: char) -> bool {
        if BOUNDARIES.contains(&ch) {
            self.chars.clear();
            true
        } else if ch == '\x08' {
            // backspace
            self.chars.pop();
            false
        } else if ch.is_alphabetic() || ch == '\'' || ch == '-' {
            self.chars.push(ch);
            false
        } else {
            false
        }
    }

    pub fn current(&self) -> String {
        self.chars.iter().collect()
    }

    pub fn clear(&mut self) {
        self.chars.clear();
    }

    /// Characters to send when user taps `full_word` — the suffix after the partial.
    pub fn completion_suffix(&self, full_word: &str) -> String {
        let partial = self.current();
        if full_word.to_lowercase().starts_with(&partial.to_lowercase()) && partial.len() <= full_word.len() {
            full_word[partial.len()..].to_string()
        } else {
            full_word.to_string()
        }
    }
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/desktop/src-tauri && cargo test autocomplete::buffer 2>&1 | tail -10
```

Expected: `test result: ok. 7 passed`.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src-tauri/src/autocomplete/buffer.rs
git commit -m "feat: word buffer with boundary detection"
```

---

## Task 3: Dictionary Completions

**Files:**
- Create: `src-tauri/src/autocomplete/spell.rs`

- [ ] **Step 1: Write failing tests**

Create `src-tauri/src/autocomplete/spell.rs` with stub + tests:

```rust
use std::sync::OnceLock;

static WORDS: OnceLock<Vec<String>> = OnceLock::new();

fn load_words() -> Vec<String> {
    todo!()
}

pub fn get_completions(partial: &str, count: usize) -> Vec<String> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_completions_for_hel() {
        let results = get_completions("hel", 5);
        assert!(!results.is_empty(), "expected completions for 'hel'");
        assert!(results.iter().all(|w| w.to_lowercase().starts_with("hel")));
    }

    #[test]
    fn test_completions_respects_count() {
        let results = get_completions("the", 3);
        assert!(results.len() <= 3);
    }

    #[test]
    fn test_short_partial_returns_empty() {
        let results = get_completions("a", 5);
        assert!(results.is_empty());
    }

    #[test]
    fn test_unknown_partial_returns_empty() {
        let results = get_completions("zzzzzzzzz", 5);
        assert!(results.is_empty());
    }
}
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd packages/desktop/src-tauri && cargo test autocomplete::spell 2>&1 | tail -10
```

Expected: FAILED — `todo!()` panics.

- [ ] **Step 3: Implement**

Replace stubs in `spell.rs`:

```rust
use std::sync::OnceLock;

static WORDS: OnceLock<Vec<String>> = OnceLock::new();

fn get_words() -> &'static Vec<String> {
    WORDS.get_or_init(|| {
        let raw = std::fs::read_to_string("/usr/share/dict/words").unwrap_or_default();
        let set: std::collections::BTreeSet<String> = raw
            .lines()
            .filter(|w| w.len() > 2 && w.chars().all(|c| c.is_ascii_alphabetic()))
            .map(|w| w.to_lowercase())
            .collect();
        set.into_iter().collect()
    })
}

pub fn get_completions(partial: &str, count: usize) -> Vec<String> {
    if partial.len() < 2 {
        return vec![];
    }
    let partial_lower = partial.to_lowercase();
    let words = get_words();
    let start = words.partition_point(|w| w.as_str() < partial_lower.as_str());
    let capitalize = partial.chars().next().map(|c| c.is_uppercase()).unwrap_or(false);
    words[start..]
        .iter()
        .take_while(|w| w.starts_with(&partial_lower))
        .take(count)
        .map(|w| {
            if capitalize {
                let mut chars = w.chars();
                match chars.next() {
                    None => String::new(),
                    Some(c) => c.to_uppercase().to_string() + chars.as_str(),
                }
            } else {
                w.clone()
            }
        })
        .collect()
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/desktop/src-tauri && cargo test autocomplete::spell 2>&1 | tail -10
```

Expected: `test result: ok. 4 passed`.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src-tauri/src/autocomplete/spell.rs
git commit -m "feat: dictionary completions via /usr/share/dict/words"
```

---

## Task 4: Keyboard Monitor Thread

**Files:**
- Create: `src-tauri/src/autocomplete/tap.rs`

- [ ] **Step 1: Create tap.rs with start_monitor**

Create `src-tauri/src/autocomplete/tap.rs`:

```rust
use std::sync::Arc;
use std::time::Duration;

use super::buffer::WordBuffer;
use super::state::AutocompleteState;

pub fn start_monitor(state: Arc<AutocompleteState>) {
    // Idle-reset task: if no keystroke for 3s, show fallback phrases.
    let idle_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(1));
        loop {
            interval.tick().await;
            let elapsed = idle_state
                .last_keystroke
                .lock()
                .unwrap()
                .elapsed();
            if elapsed > Duration::from_secs(3) {
                let current = idle_state.suggestions_rx.borrow().clone();
                let fallback = idle_state.config.lock().unwrap().fallback_phrases.clone();
                if current != fallback {
                    idle_state.reset_to_fallback();
                }
            }
        }
    });

    // Keyboard tap thread — rdev::listen is blocking.
    std::thread::spawn(move || {
        let mut buffer = WordBuffer::new();
        if let Err(e) = rdev::listen(move |event: rdev::Event| {
            if !state.is_enabled() {
                return;
            }
            if let rdev::EventType::KeyPress(_) = event.event_type {
                if let Some(name) = event.name {
                    if let Some(ch) = name.chars().next() {
                        let was_boundary = buffer.push(ch);
                        let (count, fallback) = {
                            let cfg = state.config.lock().unwrap();
                            (cfg.suggestion_count, cfg.fallback_phrases.clone())
                        };
                        if was_boundary {
                            state.set_suggestions(fallback);
                            return;
                        }
                        let partial = buffer.current();
                        if partial.len() < 2 {
                            return;
                        }
                        let completions = super::spell::get_completions(&partial, count);
                        if completions.is_empty() {
                            state.set_suggestions(fallback);
                        } else {
                            state.set_suggestions(completions);
                        }
                    }
                }
            }
        }) {
            tracing::warn!(error = ?e, "keyboard monitor stopped (check Accessibility permission in System Settings → Privacy & Security)");
        }
    });
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd packages/desktop/src-tauri && cargo check 2>&1 | grep "^error" | head -10
```

Expected: no errors (rdev only compiles on macOS targets).

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src-tauri/src/autocomplete/tap.rs
git commit -m "feat: rdev keyboard monitor with idle reset"
```

---

## Task 5: New Execute Actions (type + clipboard)

**Files:**
- Modify: `src-tauri/src/commands/system.rs`
- Modify: `src-tauri/src/server/routes.rs`

- [ ] **Step 1: Write tests for new execute actions**

In `src-tauri/src/server/routes.rs`, find the `#[cfg(test)]` block and add inside it (using the existing `app.oneshot(req)` pattern):

```rust
#[tokio::test]
async fn execute_type_text_from_lan() {
    let state = state_with_profile("tok", vec![]).await;
    let app = create_router(state);
    let req = Request::builder()
        .method("POST")
        .uri("/api/execute")
        .header("content-type", "application/json")
        .extension(axum::extract::ConnectInfo(
            std::net::SocketAddr::from(([192,168,1,1], 12345))
        ))
        .body(Body::from(r#"{"action":"type","text":"lo"}"#))
        .unwrap();
    // type action can't run in CI (no keyboard/osascript), but must NOT return 400.
    let resp = app.oneshot(req).await.unwrap();
    assert_ne!(resp.status(), StatusCode::BAD_REQUEST, "type action shape should be accepted");
}

#[tokio::test]
async fn execute_clipboard_from_lan() {
    let state = state_with_profile("tok", vec![]).await;
    let app = create_router(state);
    let req = Request::builder()
        .method("POST")
        .uri("/api/execute")
        .header("content-type", "application/json")
        .extension(axum::extract::ConnectInfo(
            std::net::SocketAddr::from(([192,168,1,1], 12345))
        ))
        .body(Body::from(r#"{"action":"clipboard","text":"hello"}"#))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_ne!(resp.status(), StatusCode::BAD_REQUEST, "clipboard action shape should be accepted");
}
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd packages/desktop/src-tauri && cargo test execute_type_text_from_lan execute_clipboard_from_lan 2>&1 | tail -15
```

Expected: both FAIL with `400 Bad Request` since the shape isn't handled yet.

- [ ] **Step 3: Add type_text and set_clipboard to system.rs**

In `src-tauri/src/commands/system.rs`, add after `open_url`:

```rust
#[tauri::command]
pub async fn type_text(text: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if text.is_empty() {
            return Ok(());
        }
        // Escape single quotes in the text for AppleScript
        let escaped = text.replace('\'', "'\\''");
        let output = Command::new("osascript")
            .args(["-e", &format!("tell application \"System Events\" to keystroke \"{}\"", escaped)])
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            return Err(format!("keystroke failed: {err}"));
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    Err("type_text only supported on macOS".into())
}

#[tauri::command]
pub async fn set_clipboard(text: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Stdio;
        let mut child = Command::new("pbcopy")
            .stdin(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;
        if let Some(stdin) = child.stdin.as_mut() {
            use std::io::Write;
            stdin.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
        }
        child.wait().map(|_| ()).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    Err("set_clipboard only supported on macOS".into())
}
```

- [ ] **Step 4: Extend ExecuteBody and execute_handler in routes.rs**

Find `ExecuteBody` (near line 286 in routes.rs):

Current:
```rust
// (inside execute_handler) — body has a context field
```

Find the struct definition (search for `struct ExecuteBody` or `ExecuteBody`). It's likely:
```rust
#[derive(Deserialize)]
struct ExecuteBody { context: Option<String> }
```

Replace the `ExecuteBody` struct with:

```rust
#[derive(Deserialize)]
struct ExecuteBody {
    context: Option<String>,
    action: Option<String>,
    text: Option<String>,
}
```

In `execute_handler`, add a new branch BEFORE the existing `if let Some(ctx) = body.context` block:

```rust
// New action-based dispatch (type / clipboard) — no button context needed
if let Some(action) = &body.action {
    return match action.as_str() {
        "type" => {
            let text = body.text.clone().unwrap_or_default();
            match crate::commands::system::type_text(text).await {
                Ok(()) => Json(serde_json::json!({"success": true})).into_response(),
                Err(e) => (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({"error": e}))).into_response(),
            }
        }
        "clipboard" => {
            let text = body.text.clone().unwrap_or_default();
            match crate::commands::system::set_clipboard(text).await {
                Ok(()) => Json(serde_json::json!({"success": true})).into_response(),
                Err(e) => (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({"error": e}))).into_response(),
            }
        }
        other => (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": format!("unknown action: {other}")}))).into_response(),
    };
}
```

- [ ] **Step 5: Run tests**

```bash
cd packages/desktop/src-tauri && cargo test execute_type_text_from_lan execute_clipboard_from_lan 2>&1 | tail -10
```

Expected: `test result: ok. 2 passed`.

- [ ] **Step 6: Run full test suite**

```bash
cd packages/desktop/src-tauri && cargo test 2>&1 | tail -5
```

Expected: all existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src-tauri/src/commands/system.rs \
        packages/desktop/src-tauri/src/server/routes.rs
git commit -m "feat: type and clipboard execute actions"
```

---

## Task 6: SSE /api/autocomplete Route

**Files:**
- Modify: `src-tauri/src/server/routes.rs`
- Modify: `src-tauri/src/server/state.rs`

- [ ] **Step 1: Add AutocompleteState to AppState**

In `src-tauri/src/server/state.rs`, add the import at top:

```rust
use crate::autocomplete::state::{AutocompleteConfig, AutocompleteState};
```

In the `AppState` struct, add one field:

```rust
pub struct AppState {
    pub config_dir: PathBuf,
    pub port: Mutex<Option<u16>>,
    pub csrf_token: String,
    pub plugin_host: Arc<tokio::sync::Mutex<crate::plugin::PluginHost>>,
    pub plugin_render: Arc<Mutex<PluginRenderState>>,
    pub app_handle: Mutex<Option<tauri::AppHandle>>,
    pub autocomplete: Arc<AutocompleteState>,   // ← add this
}
```

In `AppState::new()`, add initialization before the final `Self { ... }`:

```rust
let autocomplete_config = AutocompleteConfig::default();
let autocomplete = Arc::new(AutocompleteState::new(autocomplete_config));
```

And add to the struct literal:

```rust
Self {
    config_dir,
    port: Mutex::new(None),
    csrf_token,
    plugin_host,
    plugin_render,
    app_handle: Mutex::new(None),
    autocomplete,   // ← add this
}
```

- [ ] **Step 2: Update state_with_profile helper (REQUIRED)**

In `routes.rs`, find the `state_with_profile` async helper function. It builds `AppState { ... }` with a struct literal. After adding `autocomplete` to `AppState`, this will fail to compile. Add the missing field:

```rust
Arc::new(AppState {
    config_dir: dir_path,
    port: std::sync::Mutex::new(None),
    csrf_token: csrf.to_string(),
    plugin_host,
    plugin_render,
    app_handle: std::sync::Mutex::new(None),
    autocomplete: Arc::new(crate::autocomplete::state::AutocompleteState::new(
        crate::autocomplete::state::AutocompleteConfig::default(),
    )),  // ← add this
})
```

- [ ] **Step 3: Write a test for the SSE route**

In `routes.rs` test block, add (matching the existing `app.oneshot(req)` pattern):

```rust
#[tokio::test]
async fn autocomplete_sse_returns_200() {
    let state = state_with_profile("tok", vec![]).await;
    let app = create_router(state);
    let req = Request::builder()
        .method("GET")
        .uri("/api/autocomplete")
        .extension(axum::extract::ConnectInfo(
            std::net::SocketAddr::from(([192,168,1,1], 12345))
        ))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(
        resp.headers().get("content-type").and_then(|v| v.to_str().ok()),
        Some("text/event-stream")
    );
}
```

- [ ] **Step 3: Run to verify it fails**

```bash
cd packages/desktop/src-tauri && cargo test autocomplete_sse_returns_200 2>&1 | tail -10
```

Expected: FAIL — route doesn't exist yet.

- [ ] **Step 4: Add SSE handler to routes.rs**

Add imports at top of `routes.rs`:

```rust
use axum::response::sse::{Event, Sse};
use futures_util::stream;
use std::convert::Infallible;
use futures_util::Stream;
```

Add the handler function after `execute_handler`:

```rust
async fn autocomplete_sse_handler(
    State(state): State<Arc<AppState>>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let mut rx = state.autocomplete.suggestions_rx.clone();
    // Send current value immediately on connect
    let initial = rx.borrow().clone();
    let initial_json = serde_json::to_string(&serde_json::json!({"words": initial}))
        .unwrap_or_default();

    let stream = stream::unfold((rx, Some(initial_json)), |(mut rx, pending)| async move {
        if let Some(data) = pending {
            return Some((Ok(Event::default().data(data)), (rx, None)));
        }
        rx.changed().await.ok()?;
        let words = rx.borrow_and_update().clone();
        let json = serde_json::to_string(&serde_json::json!({"words": words}))
            .unwrap_or_default();
        Some((Ok(Event::default().data(json)), (rx, None)))
    });

    Sse::new(stream).keep_alive(axum::response::sse::KeepAlive::default())
}
```

In `create_router`, add the route to the public router (NOT inside `admin`):

```rust
.route("/api/autocomplete", get(autocomplete_sse_handler))
```

Add it alongside other public routes like `/api/config` and `/api/health`.

- [ ] **Step 5: Run tests**

```bash
cd packages/desktop/src-tauri && cargo test autocomplete_sse_returns_200 2>&1 | tail -10
```

Expected: `test result: ok. 1 passed`.

- [ ] **Step 6: Cargo check**

```bash
cd packages/desktop/src-tauri && cargo check 2>&1 | grep "^error" | head -10
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src-tauri/src/server/state.rs \
        packages/desktop/src-tauri/src/server/routes.rs
git commit -m "feat: GET /api/autocomplete SSE route"
```

---

## Task 7: Tauri Commands + Wire into AppState + app.rs Startup

**Files:**
- Create: `src-tauri/src/commands/autocomplete.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/app.rs`

- [ ] **Step 1: Check commands/mod.rs exists and add autocomplete module**

```bash
cat packages/desktop/src-tauri/src/commands/mod.rs
```

Add `pub mod autocomplete;` to the file. If no `mod.rs` exists, check the directory structure:

```bash
ls packages/desktop/src-tauri/src/commands/
```

If files are directly in `commands/` with no `mod.rs`, the modules are declared in `lib.rs`. In that case, add to `lib.rs`:

```rust
pub mod commands {
    pub mod autocomplete;
}
```

Or if `commands/mod.rs` exists, add `pub mod autocomplete;` there.

- [ ] **Step 2: Create commands/autocomplete.rs**

Create `src-tauri/src/commands/autocomplete.rs`:

```rust
use std::sync::Arc;
use tauri::State;

use crate::autocomplete::state::AutocompleteConfig;
use crate::server::state::AppState;

fn config_path(state: &AppState) -> std::path::PathBuf {
    state.config_dir.join("autocomplete.json")
}

async fn load_config(state: &AppState) -> AutocompleteConfig {
    let path = config_path(state);
    tokio::fs::read_to_string(&path)
        .await
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

async fn save_config(state: &AppState, config: &AutocompleteConfig) -> std::io::Result<()> {
    let path = config_path(state);
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let json = serde_json::to_string_pretty(config)
        .map_err(std::io::Error::other)?;
    tokio::fs::write(path, json).await
}

#[tauri::command]
pub async fn get_autocomplete_config(
    state: State<'_, Arc<AppState>>,
) -> Result<AutocompleteConfig, String> {
    Ok(load_config(&state).await)
}

#[tauri::command]
pub async fn set_autocomplete_enabled(
    enabled: bool,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let mut config = load_config(&state).await;
    config.enabled = enabled;
    *state.autocomplete.config.lock().unwrap() = config.clone();
    save_config(&state, &config).await.map_err(|e| e.to_string())?;
    if enabled {
        #[cfg(target_os = "macos")]
        crate::autocomplete::tap::start_monitor(state.autocomplete.clone());
    }
    Ok(())
}

#[tauri::command]
pub async fn set_autocomplete_suggestion_count(
    count: usize,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let clamped = if count <= 3 { 3 } else { 5 };
    let mut config = load_config(&state).await;
    config.suggestion_count = clamped;
    *state.autocomplete.config.lock().unwrap() = config.clone();
    save_config(&state, &config).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_autocomplete_fallback_phrases(
    phrases: Vec<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let mut config = load_config(&state).await;
    config.fallback_phrases = phrases;
    *state.autocomplete.config.lock().unwrap() = config.clone();
    save_config(&state, &config).await.map_err(|e| e.to_string())?;
    // If not typing, refresh displayed fallback immediately
    state.autocomplete.reset_to_fallback();
    Ok(())
}

#[tauri::command]
pub fn get_accessibility_status() -> bool {
    #[cfg(target_os = "macos")]
    {
        // AXIsProcessTrusted: returns true if Accessibility permission granted
        extern "C" {
            fn AXIsProcessTrusted() -> bool;
        }
        unsafe { AXIsProcessTrusted() }
    }
    #[cfg(not(target_os = "macos"))]
    false
}
```

- [ ] **Step 3: Register new commands in app.rs**

In `src-tauri/src/app.rs`, in the `invoke_handler!` block, add:

```rust
crate::commands::autocomplete::get_autocomplete_config,
crate::commands::autocomplete::set_autocomplete_enabled,
crate::commands::autocomplete::set_autocomplete_suggestion_count,
crate::commands::autocomplete::set_autocomplete_fallback_phrases,
crate::commands::autocomplete::get_accessibility_status,
```

- [ ] **Step 4: Start monitor on startup if enabled**

In `app.rs` `setup` closure, after `*state.app_handle.lock().unwrap() = Some(app.handle().clone());`, add:

```rust
// Start autocomplete keyboard monitor if enabled
{
    let ac_state = app_state.autocomplete.clone();
    if ac_state.is_enabled() {
        #[cfg(target_os = "macos")]
        crate::autocomplete::tap::start_monitor(ac_state);
    }
}
```

Also, load persisted autocomplete config at startup. In the `tauri::async_runtime::spawn` block where `crate::server::start` is called, add before the `start` call:

```rust
// Load persisted autocomplete config
{
    let ac_config = crate::commands::autocomplete::load_config_raw(&state).await;
    *state.autocomplete.config.lock().unwrap() = ac_config.clone();
    state.autocomplete.reset_to_fallback();
}
```

Add a public helper in `commands/autocomplete.rs`:

```rust
/// Public helper for startup config loading (not a Tauri command).
pub async fn load_config_raw(state: &AppState) -> AutocompleteConfig {
    load_config(state).await
}
```

- [ ] **Step 5: cargo check**

```bash
cd packages/desktop/src-tauri && cargo check 2>&1 | grep "^error" | head -20
```

Fix any errors. Common ones:
- Missing `pub mod autocomplete` in commands mod — add it
- `AXIsProcessTrusted` link: add `#[link(name = "ApplicationServices", kind = "framework")]` extern block on macOS

If the `extern "C"` link fails, replace `get_accessibility_status` with a simpler approach:

```rust
#[tauri::command]
pub fn get_accessibility_status() -> bool {
    #[cfg(target_os = "macos")]
    {
        let out = std::process::Command::new("osascript")
            .args(["-e", "tell application \"System Events\" to keystroke \"\""])
            .output();
        out.map(|o| o.status.success()).unwrap_or(false)
    }
    #[cfg(not(target_os = "macos"))]
    false
}
```

- [ ] **Step 6: cargo test**

```bash
cd packages/desktop/src-tauri && cargo test 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src-tauri/src/commands/autocomplete.rs \
        packages/desktop/src-tauri/src/commands/mod.rs \
        packages/desktop/src-tauri/src/app.rs
git commit -m "feat: autocomplete Tauri commands + startup wiring"
```

---

## Task 8: LAN Panel Suggestion Strip

**Files:**
- Modify: `packages/frontend/app.js`
- Modify: `packages/frontend/style.css`

- [ ] **Step 1: Add suggestion strip to index.html**

Open `packages/frontend/index.html`. After the `<div id="grid-container">` element, add:

```html
<div id="suggestion-strip" class="suggestion-strip"></div>
```

- [ ] **Step 2: Add strip styles to style.css**

Add at the end of `packages/frontend/style.css`:

```css
/* ── Suggestion strip (Touch Bar mimic) ─────────────────── */
.suggestion-strip {
  display: flex;
  flex-direction: row;
  gap: 8px;
  padding: 8px 12px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  flex-shrink: 0;
  min-height: 48px;
  align-items: center;
  background: var(--bg-secondary, #111);
  border-top: 1px solid var(--border, rgba(255,255,255,0.08));
}

.suggestion-strip::-webkit-scrollbar {
  display: none;
}

.suggestion-chip {
  flex-shrink: 0;
  padding: 6px 14px;
  border-radius: 20px;
  background: var(--chip-bg, rgba(255,255,255,0.12));
  color: var(--text-primary, #fff);
  font-size: 14px;
  font-weight: 500;
  border: none;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  transition: background 0.12s ease, transform 0.08s ease;
  white-space: nowrap;
  touch-action: manipulation;
  min-height: 36px;
  display: flex;
  align-items: center;
}

.suggestion-chip:active {
  background: var(--chip-active-bg, rgba(255,255,255,0.25));
  transform: scale(0.93);
}

.suggestion-chip.long-pressed {
  background: var(--accent, #3a6ea5);
}

/* Light mode overrides */
body.light-mode .suggestion-strip {
  background: var(--bg-secondary-light, #f0f0f0);
  border-top-color: rgba(0,0,0,0.1);
}

body.light-mode .suggestion-chip {
  background: rgba(0,0,0,0.08);
  color: #111;
}
```

- [ ] **Step 3: Add SSE subscription and strip rendering to app.js**

In `packages/frontend/app.js`, after the `let pluginRender = ...` line (near top), add:

```js
let autocompleteWords = [];
let autocompleteSource = null;
```

Add a new function after `startHealthPing`:

```js
function renderSuggestionStrip() {
  const strip = document.getElementById("suggestion-strip");
  if (!strip) return;
  strip.innerHTML = "";
  autocompleteWords.forEach((word) => {
    const chip = document.createElement("button");
    chip.className = "suggestion-chip";
    chip.textContent = word;

    let longPressTimer = null;
    let didLongPress = false;

    chip.addEventListener("touchstart", (e) => {
      didLongPress = false;
      longPressTimer = setTimeout(() => {
        didLongPress = true;
        chip.classList.add("long-pressed");
        handleChipAction(word, "clipboard");
      }, 500);
    }, { passive: true });

    chip.addEventListener("touchend", () => {
      clearTimeout(longPressTimer);
      chip.classList.remove("long-pressed");
      if (!didLongPress) {
        handleChipAction(word, "type");
      }
    });

    chip.addEventListener("touchcancel", () => {
      clearTimeout(longPressTimer);
      chip.classList.remove("long-pressed");
    });

    // Desktop fallback: click = type, right-click = clipboard
    chip.addEventListener("click", () => {
      if (!didLongPress) handleChipAction(word, "type");
    });

    strip.appendChild(chip);
  });
}

async function handleChipAction(word, action) {
  try {
    await fetch(`${api.baseUrl}/api/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, text: word }),
    });
  } catch (err) {
    console.error("chip action failed:", err);
  }
}

function startAutocompleteSSE() {
  if (autocompleteSource) autocompleteSource.close();
  autocompleteSource = new EventSource(`${api.baseUrl}/api/autocomplete`);

  autocompleteSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (Array.isArray(data.words)) {
        autocompleteWords = data.words;
        renderSuggestionStrip();
      }
    } catch (_) {}
  };

  autocompleteSource.onerror = () => {
    autocompleteSource.close();
    autocompleteSource = null;
    // Reconnect with backoff
    setTimeout(startAutocompleteSSE, 3000);
  };
}
```

In the `DOMContentLoaded` handler, after `startHealthPing()`, add:

```js
startAutocompleteSSE();
```

Note: for the type action, `word` is the FULL word. The backend's `type_text` will type the whole string. The backend should ideally type only the suffix — but since the keyboard monitor on macOS handles word context, typing the full word is correct for cases where the user wants to replace or insert. The simplest UX is: tap types the full word (not just suffix). If partial-word completion is desired, the frontend needs to know the current partial word, which would require another endpoint. For now, type the full word.

- [ ] **Step 4: Check index.html exists and has suggestion-strip div**

```bash
grep -n "suggestion-strip\|grid-container" packages/frontend/index.html
```

If `index.html` doesn't have `suggestion-strip`, add it after `grid-container`:

```bash
# Verify the file structure first
cat packages/frontend/index.html
```

Add `<div id="suggestion-strip" class="suggestion-strip"></div>` in the appropriate place in the HTML body.

- [ ] **Step 5: Manual test (dev server)**

```bash
cd packages/desktop && npm run tauri dev
```

Open the LAN panel in a browser at `http://localhost:PORT/apps/`. You should see the suggestion strip at the bottom with the default fallback phrases ("Thanks", "On my way", "👍"). Tap a chip and verify it shows a network request to `/api/execute`.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/index.html \
        packages/frontend/app.js \
        packages/frontend/style.css
git commit -m "feat: suggestion strip with SSE and tap/long-press handlers"
```

---

## Task 9: Admin UI Autocomplete Settings

**Files:**
- Create: `packages/desktop/src/AutocompleteSettings.tsx`
- Modify: `packages/desktop/src/lib/invoke.ts`
- Modify: `packages/desktop/src/PannaApp.tsx`

- [ ] **Step 1: Add invoke wrappers**

In `packages/desktop/src/lib/invoke.ts`, add:

```typescript
export interface AutocompleteConfig {
  enabled: boolean
  suggestion_count: number
  fallback_phrases: string[]
}

export const getAutocompleteConfig = () =>
  invoke<AutocompleteConfig>('get_autocomplete_config')

export const setAutocompleteEnabled = (enabled: boolean) =>
  invoke<void>('set_autocomplete_enabled', { enabled })

export const setAutocompleteSuggestionCount = (count: number) =>
  invoke<void>('set_autocomplete_suggestion_count', { count })

export const setAutocompleteFallbackPhrases = (phrases: string[]) =>
  invoke<void>('set_autocomplete_fallback_phrases', { phrases })

export const getAccessibilityStatus = () =>
  invoke<boolean>('get_accessibility_status')
```

- [ ] **Step 2: Create AutocompleteSettings.tsx**

Create `packages/desktop/src/AutocompleteSettings.tsx`:

```tsx
import React, { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { AutocompleteConfig } from './lib/invoke'
import {
  getAutocompleteConfig, setAutocompleteEnabled,
  setAutocompleteSuggestionCount, setAutocompleteFallbackPhrases,
  getAccessibilityStatus,
} from './lib/invoke'
import type { Theme } from './theme'

interface Props {
  theme: ReturnType<typeof import('./theme').makeTheme>
}

export function AutocompleteSettings({ theme }: Props) {
  const [config, setConfig] = useState<AutocompleteConfig | null>(null)
  const [accessOk, setAccessOk] = useState<boolean | null>(null)
  const [fallbackInput, setFallbackInput] = useState("")

  useEffect(() => {
    getAutocompleteConfig().then(setConfig)
    getAccessibilityStatus().then(setAccessOk)
  }, [])

  if (!config) return null

  const row: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 0', borderBottom: `0.5px solid ${theme.border}`,
  }
  const label: React.CSSProperties = { fontSize: 12, color: theme.text }
  const muted: React.CSSProperties = { fontSize: 11, color: theme.textMute }

  async function toggle() {
    const next = !config!.enabled
    await setAutocompleteEnabled(next)
    setConfig({ ...config!, enabled: next })
    if (next) setAccessOk(await getAccessibilityStatus())
  }

  async function setCount(count: number) {
    await setAutocompleteSuggestionCount(count)
    setConfig({ ...config!, suggestion_count: count })
  }

  async function addFallback() {
    if (!fallbackInput.trim()) return
    const phrases = [...config!.fallback_phrases, fallbackInput.trim()]
    await setAutocompleteFallbackPhrases(phrases)
    setConfig({ ...config!, fallback_phrases: phrases })
    setFallbackInput("")
  }

  async function removeFallback(i: number) {
    const phrases = config!.fallback_phrases.filter((_, idx) => idx !== i)
    await setAutocompleteFallbackPhrases(phrases)
    setConfig({ ...config!, fallback_phrases: phrases })
  }

  const toggleStyle: React.CSSProperties = {
    width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
    background: config.enabled ? '#3a6ea5' : (theme.dark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'),
    position: 'relative', transition: 'background 0.2s',
  }

  return (
    <div style={{ padding: '12px 0' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: theme.textFaint, marginBottom: 8 }}>
        Autocomplete (Touch Bar)
      </div>

      {/* Enable toggle */}
      <div style={row}>
        <span style={label}>Enable word suggestions</span>
        <button style={toggleStyle} onClick={toggle} aria-label="toggle autocomplete" />
      </div>

      {/* Accessibility warning */}
      {config.enabled && accessOk === false && (
        <div style={{ padding: '6px 8px', background: 'rgba(255,165,0,0.15)', borderRadius: 6, fontSize: 11, color: theme.textMute, marginTop: 4 }}>
          ⚠ Needs Accessibility permission — System Settings → Privacy & Security → Accessibility
        </div>
      )}

      {/* Suggestion count */}
      <div style={row}>
        <span style={label}>Suggestions shown</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {[3, 5].map(n => (
            <button key={n} onClick={() => setCount(n)} style={{
              padding: '3px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12,
              background: config.suggestion_count === n ? '#3a6ea5' : (theme.dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'),
              color: config.suggestion_count === n ? '#fff' : theme.text,
            }}>{n}</button>
          ))}
        </div>
      </div>

      {/* Fallback phrases */}
      <div style={{ marginTop: 8 }}>
        <span style={{ ...muted, display: 'block', marginBottom: 4 }}>Fallback phrases (shown when idle)</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
          {config.fallback_phrases.map((p, i) => (
            <span key={i} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '2px 8px', borderRadius: 12,
              background: theme.dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
              fontSize: 12, color: theme.text,
            }}>
              {p}
              <button onClick={() => removeFallback(i)} style={{ all: 'unset', cursor: 'pointer', color: theme.textMute, fontSize: 10 }}>✕</button>
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            value={fallbackInput}
            onChange={e => setFallbackInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addFallback()}
            placeholder="Add phrase…"
            style={{
              flex: 1, padding: '4px 8px', fontSize: 12, borderRadius: 6, border: `0.5px solid ${theme.border}`,
              background: theme.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
              color: theme.text, outline: 'none',
            }}
          />
          <button onClick={addFallback} style={{
            padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
            background: '#3a6ea5', color: '#fff', fontSize: 12,
          }}>Add</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Wire AutocompleteSettings into PannaApp.tsx**

In `packages/desktop/src/PannaApp.tsx`:

Add import at top:

```typescript
import { AutocompleteSettings } from './AutocompleteSettings'
```

In `PannaApp.tsx`, the right panel shows either `palette` or `inspector` based on `rightView` state (line ~543). Find the section:

```tsx
{rightView === 'inspector' && selectedSlot != null ? (
  <Inspector ...
```

There is also a `palette` branch. Add `AutocompleteSettings` at the BOTTOM of the palette branch (shown when no slot is selected):

```tsx
{rightView === 'palette' && (
  <>
    {/* existing ActionPalette content */}
    <AutocompleteSettings theme={theme} />
  </>
)}
```

If the palette branch doesn't use a fragment, wrap the existing content + new component in `<>...</>`.

The variable for selected slot in PannaApp.tsx is `selectedSlot` (not `selectedSlotId`).

- [ ] **Step 4: Build admin UI**

```bash
cd packages/desktop && npm run build 2>&1 | tail -20
```

Fix any TypeScript errors. Common ones:
- Missing `Theme` type import — add `import type { Theme } from './theme'`
- `invoke` import needed — it's imported via `lib/invoke.ts` wrappers

- [ ] **Step 5: Manual test**

```bash
cd packages/desktop && npm run tauri dev
```

Open admin UI. Verify:
1. Autocomplete settings section is visible in inspector when no slot selected
2. Toggle enables/disables
3. Accessibility warning appears if permission not granted
4. Suggestion count buttons work (3 / 5)
5. Fallback phrases can be added and removed

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/AutocompleteSettings.tsx \
        packages/desktop/src/lib/invoke.ts \
        packages/desktop/src/PannaApp.tsx
git commit -m "feat: admin UI settings for autocomplete"
```

---

## Task 10: cargo test + Integration Smoke

**Files:**
- `src-tauri/` (tests only)

- [ ] **Step 1: Run full Rust test suite**

```bash
cd packages/desktop/src-tauri && cargo test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 2: cargo clippy**

```bash
cd packages/desktop/src-tauri && cargo clippy 2>&1 | grep "^error" | head -10
```

Fix any errors. Warnings are OK.

- [ ] **Step 3: Smoke test — enable autocomplete and type**

```bash
cd packages/desktop && npm run tauri dev
```

1. Open admin UI → enable Autocomplete
2. If Accessibility permission prompt appears, grant it in System Settings
3. Open any text editor on your Mac and start typing "hel"
4. LAN panel should update chips to show "hello", "help", "held" etc.
5. Tap a chip → correct suffix typed into the text editor
6. Long-press a chip → word copied to clipboard (verify with Cmd+V)
7. Stop typing for 3 seconds → strip resets to fallback phrases

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: touch bar autocomplete complete"
```
