# Plugin System Design

**Date:** 2026-05-04
**Branch:** cubic-game
**Status:** Approved — pending implementation plan

## Goal

Replace Panna Cotta's hardcoded action system with a fully extensible plugin architecture that is drop-in compatible with the Elgato Stream Deck plugin ecosystem. Existing plugins built for Stream Deck should work without modification. Contributors publish plugins as npm packages or drop `.sdPlugin` directories into `~/.panna-cotta/plugins/`.

**Reference implementation studied:** [OpenDeck](https://github.com/nekename/OpenDeck) — same Tauri + Rust stack, full Elgato protocol implementation.

---

## 1. Architecture

Five new subsystems added to the Rust backend alongside the existing Axum HTTP server:

```
┌─────────────────────────────────────────────────────┐
│                   Panna Cotta Host                  │
│                                                     │
│  ┌─────────────┐  ┌────────────┐  ┌─────────────┐ │
│  │  Axum HTTP  │  │  WS Host   │  │  PI Server  │ │
│  │  (existing) │  │  port N    │  │  port N+2   │ │
│  └──────┬──────┘  └─────┬──────┘  └──────┬──────┘ │
│         │               │                │         │
│  ┌──────▼───────────────▼────────────────▼───────┐ │
│  │                Plugin Registry                │ │
│  │        manifest.json → action UUID map        │ │
│  └──────────────────────┬────────────────────────┘ │
│                         │                           │
│  ┌──────────────────────▼────────────────────────┐ │
│  │              Process Manager                  │ │
│  │     spawn / kill / restart node processes     │ │
│  │     keyed by plugin UUID                      │ │
│  └───────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
         ↕ WebSocket (port N)     ↕ WebSocket (port N)
┌────────────────┐        ┌─────────────────────────┐
│  Plugin proc   │        │  Property Inspector      │
│  (node.js)     │        │  (iframe in admin UI,    │
└────────────────┘        │   served from port N+2)  │
                          └─────────────────────────┘
```

**Button press flow:**
1. Phone → `POST /api/execute` → Axum
2. Axum resolves `actionUUID` → plugin UUID via registry
3. Host sends `keyDown` WebSocket event to plugin process
4. Plugin handles action, optionally calls back (`setTitle`, `showOk`, etc.)
5. Host fans state changes to all connected admin UI clients

**Two WebSocket connection types share port N:**
- Plugin process: registers with `{ "event": "registerPlugin", "uuid": "..." }`
- Property Inspector: registers with `{ "event": "registerPropertyInspector", "uuid": "..." }`

---

## 2. Data Model & Config Migration

### Button schema change

```
Current (TOML):              New (JSON):
─────────────────────────    ──────────────────────────────────────
name = "Volume Up"           {
type = "system"                "name": "Volume Up",
icon = "volume-up"             "icon": "volume-up",
action = "volume-up"           "actionUUID": "com.pannacotta.system.volume-up",
                               "context": "aB3kX9",
                               "settings": {}
                             }
```

`context` is a stable random ID per button instance. `settings` is arbitrary JSON owned by the plugin.

### Rust type

```rust
struct Button {
    name: String,
    icon: String,
    action_uuid: String,
    context: String,
    settings: serde_json::Value,
}
```

### Profile files

Switch from TOML to JSON. Files move from `*.toml` to `*.json` in `~/.panna-cotta/profiles/`.

### One-time migration

Runs on first launch when old TOML configs are detected. Old file backed up as `*.toml.bak` before migration.

| Old `type` + `action` | New `actionUUID` | Settings |
|---|---|---|
| `system` + `open-app` | `com.pannacotta.system.open-app` | `{"appName": target}` |
| `system` + `volume-up` | `com.pannacotta.system.volume-up` | `{}` |
| `system` + `volume-down` | `com.pannacotta.system.volume-down` | `{}` |
| `system` + `volume-mute` | `com.pannacotta.system.volume-mute` | `{}` |
| `system` + `brightness-up` | `com.pannacotta.system.brightness-up` | `{}` |
| `system` + `brightness-down` | `com.pannacotta.system.brightness-down` | `{}` |
| `system` + `sleep` | `com.pannacotta.system.sleep` | `{}` |
| `system` + `lock` | `com.pannacotta.system.lock` | `{}` |
| `browser` + `open-url` | `com.pannacotta.browser.open-url` | `{"url": action}` |

---

## 3. WebSocket Host & Process Manager

### WebSocket server (`src/plugin/mod.rs`)

Built with `tokio-tungstenite`. Listens on a random free port N (scanned at startup alongside Axum port). Port N stored in `~/.panna-cotta.ws-port`.

Two global socket maps (from OpenDeck's pattern):

```rust
static PLUGIN_SOCKETS: LazyLock<Mutex<HashMap<String, SplitSink<...>>>> = ...;
static PROPERTY_INSPECTOR_SOCKETS: LazyLock<Mutex<HashMap<String, SplitSink<...>>>> = ...;
static PLUGIN_QUEUES: LazyLock<RwLock<HashMap<String, Vec<Message>>>> = ...;
static PROPERTY_INSPECTOR_QUEUES: LazyLock<RwLock<HashMap<String, Vec<Message>>>> = ...;
```

**Message queuing:** Events fired before a plugin connects are queued in `PLUGIN_QUEUES` and flushed on WebSocket registration. Prevents dropped `willAppear` events during plugin startup race.

### Process manager lifecycle

```
Active profile loads
  → collect all actionUUIDs from buttons
  → map each to plugin UUID via registry
  → spawn one process per unique plugin UUID
  → fire willAppear for each configured button

Profile switches
  → diff: plugins_leaving, plugins_staying, plugins_arriving
  → SIGTERM plugins_leaving → 2s grace → SIGKILL
  → spawn plugins_arriving
  → fire willDisappear / willAppear accordingly

Plugin process crashes
  → restart: 1s, 2s, 4s, 8s backoff (capped 30s)
  → re-fire willAppear for all visible buttons after reconnect
  → 5 crashes in 60s → mark errored, stop retrying, surface error in admin UI
```

### Plugin launch command

Exact Elgato format:

```bash
{node_binary} {CodePath} \
  -port {N} \
  -pluginUUID {uuid} \
  -registerEvent registerPlugin \
  -info '{"application":{"version":"0.x.x"},"devices":[{"id":"main","size":{"columns":5,"rows":3}}]}'
```

`{node_binary}` resolves via the runtime lookup chain in Section 6.

### macOS webview keepalive

HTML-based plugins run in a hidden Tauri `WebviewWindow`. WKWebView suspends JS after ~7s when not visible. A background task evals `void(0)` every 3s on all webview plugin windows (OpenDeck-proven fix).

---

## 4. Plugin Discovery & Installation

### Discovery sources (scanned at startup and on profile switch)

1. `~/.panna-cotta/plugins/*.sdPlugin/` — drop-in folder
2. `~/.panna-cotta/node_modules/*/` — npm-installed packages; scanner looks for `*.sdPlugin/` subdirectory inside each package (Elgato npm convention). Package `panna-cotta-plugin-obs` → contains `com.obsproject.obs.sdPlugin/` → UUID is `com.obsproject.obs.sdPlugin`.

Plugins with symlinked directories are resolved before scanning.

### Plugin UUID

The directory name is the UUID. `com.example.myplugin.sdPlugin` → UUID `com.example.myplugin.sdPlugin`. Matches Elgato convention.

### npm install flow

User types package name in admin UI → backend runs:

```bash
{node_binary} {npm_path} install {package} --prefix ~/.panna-cotta
```

`npm` binary is included in the Node.js distribution and resolved alongside the node binary. After install, registry rescans without app restart.

### Manifest validation

Required (skip plugin with warning if missing):
- `CodePath` — entry point exists on disk
- `Actions` — at least one entry
- `Actions[].UUID` — non-empty string

Tolerated with warning:
- `SDKVersion != 2` — still attempt load
- `OS` platform mismatch — still attempt load

### API routes added to Axum

```
GET    /api/plugins              list all installed plugins + their actions
POST   /api/plugins/install      { "package": "panna-cotta-plugin-obs" }
DELETE /api/plugins/:uuid        uninstall
GET    /api/plugins/:uuid/status running | stopped | errored | downloading-runtime
```

---

## 5. Built-in Plugins

Current hardcoded actions become two proper plugins bundled as Tauri resources. On startup, the host copies them to `~/.panna-cotta/plugins/` using semver gating: bundled version overwrites only if newer than installed. This upgrades built-ins automatically with each app release.

### Resource layout

```
src-tauri/plugins/
  com.pannacotta.system.sdPlugin/
    manifest.json
    bin/plugin.js              ← compiled, committed
  com.pannacotta.browser.sdPlugin/
    manifest.json
    bin/plugin.js
```

### `com.pannacotta.system` actions

| Action UUID | Name |
|---|---|
| `com.pannacotta.system.open-app` | Open App |
| `com.pannacotta.system.volume-up` | Volume Up |
| `com.pannacotta.system.volume-down` | Volume Down |
| `com.pannacotta.system.volume-mute` | Mute Toggle |
| `com.pannacotta.system.brightness-up` | Brightness Up |
| `com.pannacotta.system.brightness-down` | Brightness Down |
| `com.pannacotta.system.sleep` | Sleep |
| `com.pannacotta.system.lock` | Lock Screen |

### `com.pannacotta.browser` actions

| Action UUID | Name |
|---|---|
| `com.pannacotta.browser.open-url` | Open URL |

### `pannacotta.shell` extension event

Built-in plugins need to run shell commands. They send a custom event:

```json
{ "event": "pannacotta.shell", "payload": { "cmd": "osascript", "args": [...] } }
```

Host accepts this only from plugins with `"Builtin": true` in their manifest. Third-party plugins sending this event are silently ignored. This is the only host extension beyond the standard Elgato protocol.

The entire `execute_command` match block in `commands/system.rs` is deleted. Logic moves to `com.pannacotta.system` plugin.

---

## 6. Node.js Runtime — Lazy Download

### Resolution chain

```
get_node_binary() → PathBuf
  1. ~/.panna-cotta/runtime/node   → return if exists
  2. system `node --version` ≥ v20  → return system path
  3. neither → emit "node-runtime-needed" Tauri event to frontend
```

### Download flow

1. Admin UI shows download dialog with progress bar
2. User confirms → Tauri command `download_node_runtime` fires
3. Backend downloads `node-v{LTS}-{platform}-{arch}.tar.gz` from `nodejs.org/dist`
4. SHA256 verified against `nodejs.org/dist/v{LTS}/SHASUMS256.txt`
5. On mismatch: delete download, surface error
6. On success: extract binary to `~/.panna-cotta/runtime/node`
7. Emit progress events to frontend throughout (streamed via Tauri channel)

### Version pinning

LTS version hardcoded as a build-time constant in `src/plugin/runtime.rs`. Updated deliberately with each Panna Cotta release — no automatic Node.js upgrades. Initial pin: Node.js v22 LTS.

### Download dialog

```
┌─────────────────────────────────────┐
│  Plugin Runtime Required            │
│                                     │
│  Panna Cotta needs Node.js to run   │
│  plugins (~35MB, downloaded once).  │
│                                     │
│  [Download]            [Cancel]     │
│                                     │
│  ████████████░░░░░░░░  58%         │
└─────────────────────────────────────┘
```

---

## 7. Admin UI Changes

### Action Picker (`ActionPicker.svelte` — new)

Replaces the `type` / `action` dropdowns in `ButtonEditor.svelte`. Displays all installed plugins and their actions grouped by category, sourced from `GET /api/plugins`. Includes search filter.

### Property Inspector (`PropertyInspector.svelte` — new)

Shown in the button editor once an action with a `PropertyInspectorPath` is selected.

```svelte
<iframe src="http://localhost:{piPort}/{absolutePath}|opendeck_property_inspector" />
```

The PI HTTP server (port N+2) injects a `postMessage` listener into the HTML response. The Svelte component posts `{ event: "connect", payload: [port, uuid, "registerPropertyInspector", info, actionInfo] }` into the iframe after load. This bridges the cross-origin gap without modifying plugin source.

If no `PropertyInspectorPath`: auto-generated key/value form from the action's `settings` JSON object (schema-driven fallback).

### PI HTTP server (`src/plugin/webserver.rs`)

Serves files from `~/.panna-cotta/` (config dir) via `tiny_http`. Path traversal prevented by canonicalization check — only paths under config dir are served. Injects postMessage bridge script into `*|opendeck_property_inspector` requests.

### Existing components

| Component | Change |
|---|---|
| `ButtonEditor.svelte` | Replace type/action dropdowns with `ActionPicker` + `PropertyInspector` |
| `ActionSidebar.svelte` | Source actions from `/api/plugins` instead of hardcoded list |
| `App.svelte` | Add plugin install panel, `NodeRuntimeDialog` |
| `GridEditor.svelte` | Unchanged |
| `ProfileSelector.svelte` | Unchanged |

---

## 8. Package Structure

```
packages/
  desktop/
    src/
      components/
        ActionPicker.svelte        ← new
        PropertyInspector.svelte   ← new
        NodeRuntimeDialog.svelte   ← new
        ButtonEditor.svelte        ← modified
        ActionSidebar.svelte       ← modified
        GridEditor.svelte          ← unchanged
        ProfileSelector.svelte     ← unchanged
      lib/
        types.ts                   ← Button type updated
        invoke.ts                  ← plugin commands added
    src-tauri/
      plugins/                     ← Tauri resource dir (built-in plugins)
        com.pannacotta.system.sdPlugin/
        com.pannacotta.browser.sdPlugin/
      src/
        plugin/
          mod.rs                   ← init, spawn, lifecycle, startup copy
          manifest.rs              ← manifest.json parser (PascalCase aliases)
          webserver.rs             ← tiny_http PI file server (port N+2)
          runtime.rs               ← Node.js binary resolution + download
        events/
          mod.rs                   ← socket registry + message queues
          inbound.rs               ← plugin→host message handlers
          outbound.rs              ← host→plugin message senders
          frontend.rs              ← host→Svelte Tauri event bridge
        commands/
          config.rs                ← unchanged
          system.rs                ← execute_command deleted; quit/autostart/version stay
          server_info.rs           ← unchanged
          plugins.rs               ← new: list_plugins, install_plugin, plugin_status
        server/
          routes.rs                ← /api/execute routes to WS host
          state.rs                 ← Button type updated
  plugins/
    com.pannacotta.system/
      manifest.json
      src/plugin.ts
      bin/plugin.js                ← compiled output, committed
    com.pannacotta.browser/
      manifest.json
      src/plugin.ts
      bin/plugin.js
  frontend/                        ← LAN panel, unchanged
```

### New Cargo dependencies

```toml
tokio-tungstenite = { version = "0.24", features = ["native-tls"] }
tiny_http = "0.12"
semver = "1"
reqwest = { version = "0.12", features = ["stream"] }
sha2 = "0.10"
```

---

## Migration Checklist

- [ ] Migrate profile files: TOML → JSON, `type+action` → `actionUUID+settings`
- [ ] Delete `execute_command` match block from `commands/system.rs`
- [ ] Build `com.pannacotta.system` and `com.pannacotta.browser` plugins
- [ ] Implement `src/plugin/` subsystem (manifest, runtime, mod, webserver)
- [ ] Implement `src/events/` subsystem (mod, inbound, outbound, frontend)
- [ ] Add `commands/plugins.rs` Tauri commands
- [ ] Update `server/routes.rs` `/api/execute` to route via plugin registry
- [ ] Add `ActionPicker`, `PropertyInspector`, `NodeRuntimeDialog` Svelte components
- [ ] Update `ButtonEditor` and `ActionSidebar`
- [ ] Wire `App.svelte` plugin install panel

---

## Out of Scope

- Wine support (Windows `.exe` plugins via Wine) — Linux only, not needed for macOS-first
- Native binary plugins — Node.js and HTML only for v1
- Plugin marketplace / discovery UI — install by package name only
- Multi-device support — single device (phone/tablet) per profile
