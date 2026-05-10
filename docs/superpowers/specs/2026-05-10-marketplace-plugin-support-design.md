# Marketplace Plugin Support

**Date:** 2026-05-10
**Status:** Approved

## Goal

Enable Elgato Stream Deck marketplace plugins (e.g. Spotify) to run in Panna Cotta
end-to-end: one-click install from the marketplace, plugin process spawns, buttons
display dynamic images and titles pushed by the plugin.

## Scope

- Bump SDKVersion cap from 2 → 6
- Implement missing inbound events: `setImage`, `setTitle`, `setState`, `setGlobalSettings`, `getGlobalSettings`
- New `PluginRenderState` in `AppState` to hold ephemeral per-context display data
- `GET /api/plugin-render` polling endpoint for the LAN panel
- Tauri event `plugin-render-updated` for the admin UI
- Deep-link install via `streamdeck://` URI scheme interception
- Frontend updates: LAN panel + GridEditor render plugin images/titles

## Out of Scope

- Dial/encoder hardware events (`dialRotate`, `dialDown`, `dialUp`, `touchTap`, `setFeedback`, `setFeedbackLayout`) — logged as unsupported
- Plugin auto-discovery from the Elgato install path (superseded by deep-link install)
- Multi-action support

---

## Architecture

### SDKVersion Cap

`manifest.rs` validation changes `sdk_version > 2` to `sdk_version > 6`. SDK v6
dial/encoder events are unrecognised by `dispatch()` and fall through to the existing
`record_unsupported` path.

### PluginRenderState

New struct in `server/state.rs`:

```rust
pub struct PluginRenderState {
    pub images: HashMap<String, String>, // context → data:image/... URL
    pub titles: HashMap<String, String>, // context → override title
    pub states: HashMap<String, u32>,    // context → state index
}
```

Added to `AppState` as `pub plugin_render: Mutex<PluginRenderState>`.

When a plugin is stopped or unloaded all its contexts are removed from all three maps.

### New Inbound Events (`inbound.rs`)

| Event | Behaviour |
|---|---|
| `setImage` | Store `payload.image` in `plugin_render.images[context]`. Fire Tauri event `plugin-render-updated`. |
| `setTitle` | Store `payload.title` in `plugin_render.titles[context]`. Fire Tauri event `plugin-render-updated`. |
| `setState` | Store `payload.state` in `plugin_render.states[context]`. No Tauri event (image update covers re-render). |
| `setGlobalSettings` | Write `payload` to `~/.panna-cotta/globals/<plugin_uuid>.json` (atomic `.tmp` rename). |
| `getGlobalSettings` | Read that file (empty object if missing), send `didReceiveGlobalSettings` back to plugin. |

All five events added to the `SUPPORTED` constant so they no longer trip `record_unsupported`.

### New Outbound Event (`outbound.rs`)

```rust
pub fn did_receive_global_settings(plugin_uuid: &str, settings: &Value) -> Value {
    json!({
        "event": "didReceiveGlobalSettings",
        "context": plugin_uuid,
        "payload": { "settings": settings }
    })
}
```

### Global Settings Storage

Path: `~/.panna-cotta/globals/<plugin_uuid>.json`

Managed by two helpers in `commands/plugins.rs`:
- `read_global_settings(config_dir, uuid) -> Value` — returns `{}` on missing file
- `write_global_settings(config_dir, uuid, value) -> Result<(), String>` — atomic write

### GET /api/plugin-render

New route in `routes.rs`. No authentication required (same posture as `/api/config`).
Read-only. Returns:

```json
{
  "images": { "<context>": "data:image/png;base64,..." },
  "titles": { "<context>": "Bohemian Rhapsody" },
  "states": { "<context>": 1 }
}
```

### Tauri IPC (`commands/plugins.rs`)

New command `get_plugin_render` mirrors the HTTP endpoint for the admin UI.

---

## Deep Link Install

### Dependency

```toml
# Cargo.toml
tauri-plugin-deep-link = "2"
```

```json
// tauri.conf.json — plugins section
"deep-link": {
  "mobile": [],
  "desktop": [{ "scheme": "streamdeck" }]
}
```

Registered in `app.rs` via `tauri_plugin_deep_link::init()`.

### URL Format

```
streamdeck://plugins/install?url=https://releases.elgato.com/.../.streamDeckPlugin
```

The `.streamDeckPlugin` file is a ZIP whose root contains exactly one `.sdPlugin` directory.

### Install Flow (`commands/plugin_install.rs`)

1. Parse `url` query param — reject anything not `https://`
2. Stream-download to a temp file — abort if response body exceeds 50 MB
3. Unzip — extract only entries under the single `.sdPlugin` dir; reject any entry with `..` components or absolute paths
4. Validate extracted `manifest.json` via `plugin::manifest::validate()`
5. Move to `~/.panna-cotta/plugins/<uuid>.sdPlugin`, overwriting any existing version
6. Re-run `scan_plugins()` and hot-load via `PluginHost` — no restart required
7. Fire Tauri event `plugin-installed { uuid, name, ok: true }`

On any failure, fire `plugin-installed { ok: false, error: "<reason>" }` and clean up temp files.

### Conflict With Stream Deck

If the official Stream Deck app is also installed, macOS last-registered-wins for URI
scheme handlers. Panna Cotta claims `streamdeck://` on first launch. A one-time dismissible
info banner in the admin UI reads: *"Panna Cotta is now handling Stream Deck marketplace
installs."*

---

## Frontend

### LAN Panel (`packages/frontend/app.js`)

- Poll `GET /api/plugin-render` on the same 1 s interval as the health ping
- When rendering a button: if `pluginRender.images[btn.context]` exists, render `<img>` instead of Lucide icon
- If `pluginRender.titles[btn.context]` exists, use it as the label instead of `btn.name`

### Admin UI — `App.svelte`

- Fetch `getPluginRender()` on mount; store as reactive `pluginRender`
- Listen for Tauri event `plugin-render-updated` → re-fetch and update store
- Listen for `plugin-installed` → toast with plugin name (or error)
- Pass `pluginRender` down to `GridEditor`

### Admin UI — `GridEditor.svelte`

- Accept `pluginRender: PluginRenderState` prop
- In grid cell render: if `pluginRender.images[btn.context]` present, render `<img src={...} style="width:100%;height:100%;object-fit:cover">` instead of emoji icon
- Title override: if `pluginRender.titles[btn.context]` present, display it instead of `btn.name`

### `types.ts`

```ts
export interface PluginRenderState {
  images: Record<string, string>
  titles: Record<string, string>
  states: Record<string, number>
}
```

### `invoke.ts`

```ts
export async function getPluginRender(): Promise<PluginRenderState> {
  return invoke('get_plugin_render')
}
```

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Download fails or times out | `plugin-installed { ok: false, error }`, temp file cleaned up |
| ZIP contains path traversal | Extraction aborted, error surfaced |
| Manifest validation fails | Plugin not installed, error surfaced |
| `setGlobalSettings` disk write fails | Log error, mark `settings_not_persisted` on plugin state (existing pattern) |
| `getGlobalSettings` file missing | Return `{}` — not an error |
| Plugin stopped while render state exists | All contexts wiped from `PluginRenderState` |

---

## Testing

- Unit tests for `plugin_install.rs`: valid ZIP, ZIP with path traversal, oversized body, bad manifest, happy path produces correct dir layout
- Unit test for `did_receive_global_settings` outbound shape
- Unit tests for `on_set_image`, `on_set_title`, `on_set_state`, `on_set_global_settings`, `on_get_global_settings` in `inbound.rs`
- Unit test for `GET /api/plugin-render` route shape
- Manifest test: `sdk_version = 6` passes, `sdk_version = 7` fails
