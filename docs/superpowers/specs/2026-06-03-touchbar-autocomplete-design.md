# Touch Bar Autocomplete — Design Spec

**Date:** 2026-06-03
**Status:** Approved

## Summary

Add a persistent word-suggestion strip to the Panna Cotta LAN panel (phone/tablet) that mimics the MacBook Touch Bar autocomplete row. macOS monitors global keystrokes via `CGEventTap`, feeds the current partial word to `NSSpellChecker` for completions, and pushes suggestions to the phone over SSE. Tapping a chip completes the word in the active Mac app; long-pressing copies it to the clipboard.

## Goals

- Phone/tablet shows 3–5 word suggestions at all times below the button grid
- Suggestions update in real time as user types on Mac keyboard
- Tap completes the partial word (keystroke injection); long-press copies to clipboard
- When idle (no typing for 3s) the strip shows user-configured fallback phrases
- Feature is opt-in; disabled by default; requires Accessibility permission

## Non-Goals

- Windows/Linux support (macOS only, `#[cfg(target_os = "macos")]`)
- AI/LLM-powered suggestions
- In-app text field autocomplete (external keyboard only)

## Architecture

Three parts: Rust backend, Axum SSE route, LAN panel strip.

### Rust Backend — `src-tauri/src/autocomplete/`

| File | Responsibility |
|------|----------------|
| `tap.rs` | `CGEventTap` global keyboard monitor; builds word buffer; clears on space/return/punctuation |
| `spell.rs` | `objc2` bridge to `NSSpellChecker.completions(forPartialWordRange:in:language:)` |
| `state.rs` | `Arc<Mutex<AutocompleteState>>` holding current word + suggestions; SSE broadcaster |

`AutocompleteState`:
```rust
struct AutocompleteState {
    enabled: bool,
    current_word: String,
    suggestions: Vec<String>,
    fallback_phrases: Vec<String>,
    suggestion_count: usize,         // 3 or 5
}
```

`CGEventTap` requires Accessibility permission. On first enable, call `AXIsProcessTrustedWithOptions` with prompt flag. If permission denied, feature stays disabled silently; admin UI surfaces a prompt.

### Axum Route

`GET /api/autocomplete` — SSE stream. Pushes on every suggestion change:

```
data: {"words":["hello","help","held"]}
```

When idle (no typing for 3s), pushes fallback phrases:

```
data: {"words":["Thanks","On my way","👍"]}
```

### LAN Panel Strip — `packages/frontend/app.js`

- `<div id="suggestion-strip">` rendered below the button grid, always visible
- Subscribes to `GET /api/autocomplete` SSE on page load
- Renders word chips; re-renders on each SSE event
- **Tap** → `POST /api/execute` with `{action:"type", text:"<completion>"}` — sends only the remaining characters (suffix after partial word). Requires new `type` action in the execute handler (currently handles `command`, `open_app`, `open_url` only).
- **Long-press (500ms)** → `POST /api/execute` with `{action:"clipboard", text:"<full word>"}` — copies full word. Requires new `clipboard` action in execute handler.
- On SSE disconnect: reconnects with exponential backoff (same pattern as health ping)

### Admin UI — `packages/desktop/src/components/AutocompleteSettings.svelte`

New "Autocomplete" section in admin settings:
- Toggle: enabled/disabled
- Suggestion count: 3 or 5
- Fallback phrases: editable list (shown when idle)
- Permission status: green "Active" or amber "Needs Accessibility permission" with link to System Settings

### New Tauri Commands (`commands/config.rs`)

- `set_autocomplete_enabled(enabled: bool)`
- `set_autocomplete_fallback_phrases(phrases: Vec<String>)`
- `set_autocomplete_suggestion_count(count: usize)`
- `get_autocomplete_config() -> AutocompleteConfig`

## Data Flow

```
User types "hel" on Mac keyboard
         │
         ▼
CGEventTap (Rust) captures keystrokes → word buffer: "hel"
         │
         ▼
NSSpellChecker returns ["hello","help","held","helm"]
         │
         ▼
AutocompleteState updated → SSE broadcaster notifies
         │
         ▼
GET /api/autocomplete (SSE) → phone receives:
  data: {"words":["hello","help","held"]}
         │
         ▼
LAN panel renders 3 chips in suggestion strip
         │
    User taps "hello"
    ├─ short tap → POST /api/execute {action:"type", text:"llo"}
    └─ long press → POST /api/execute {action:"clipboard", text:"hello"}
```

**Word boundary**: space, return, or punctuation clears the buffer. Strip resets to fallback phrases after 3s idle.

## Error Handling

| Failure | Behavior |
|---------|----------|
| `CGEventTap` creation fails (no Accessibility permission) | Feature disabled; strip shows fallback phrases only; admin UI shows permission prompt |
| SSE connection drops | LAN panel reconnects with exponential backoff |
| `NSSpellChecker` returns empty | Strip shows fallback phrases |
| Keystroke injection fails | Brief error flash on tapped chip |

## Testing

- **Unit (`cargo test`)**: word buffer logic — boundary detection, partial word extraction, buffer reset
- **E2E (Playwright)**: enable autocomplete → type in text field → assert SSE stream delivers suggestions → assert chip tap sends correct keystroke suffix

## File Checklist

```
src-tauri/src/autocomplete/
  mod.rs
  tap.rs
  spell.rs
  state.rs
src-tauri/src/server/routes.rs          ← add GET /api/autocomplete SSE
src-tauri/src/commands/config.rs        ← add autocomplete Tauri commands
src-tauri/src/app.rs                    ← register commands, init autocomplete on startup
packages/frontend/app.js               ← suggestion strip + SSE subscription
packages/frontend/style.css             ← strip styles (chips, long-press state)
packages/desktop/src/components/AutocompleteSettings.svelte
packages/desktop/src/App.svelte         ← wire in AutocompleteSettings
```
