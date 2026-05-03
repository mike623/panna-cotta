# Tauri Native Migration Design

**Date:** 2026-05-02  
**Status:** Approved  
**Branch:** artistic-sparrow

## Overview

Migrate Panna Cotta from a Deno/Hono sidecar architecture to a fully native Tauri application. All backend logic moves to Rust. A single `cargo build` produces one `.app` bundle with no external runtime dependencies.

## Goals

- One build artifact, one build command — no separate Deno compile step
- Proper native app distribution (code-signed DMG, auto-update via Tauri updater)
- Admin UI as a real Svelte SPA instead of an inline HTML string
- Eliminate sidecar lifecycle complexity (port polling, process kill on quit)
- Preserve LAN access: phones/tablets still connect via `http://192.168.x.x:PORT/apps/`

## Architecture

```
┌─────────────────────────────── Tauri App (single process) ─────────┐
│                                                                      │
│  ┌─────────────┐   Tauri IPC (invoke)   ┌──────────────────────┐   │
│  │ Admin       │ ◄────────────────────► │ Tauri Commands       │   │
│  │ Webview     │                        │  get/save config     │   │
│  │ tauri://    │                        │  profiles CRUD       │   │
│  │ /index.html │                        │  system commands     │   │
│  └─────────────┘                        │  version check       │   │
│                                         └──────────┬───────────┘   │
│  ┌─────────────┐                                   │               │
│  │ Tray Menu   │ → toggle windows                  ▼               │
│  │             │ → show QR window       ┌──────────────────────┐   │
│  └─────────────┘                        │ AppState (Arc)       │   │
│                                         │  ConfigService       │   │
│  ┌─────────────────────────┐            │  VersionCache        │   │
│  │ Axum HTTP Server        │ ◄──────────│  port: Option<u16>   │   │
│  │  /          QR page     │            └──────────────────────┘   │
│  │  /apps/*    LAN panel   │                                        │
│  │  /api/*     REST API    │                                        │
│  └─────────────────────────┘                                        │
│        ▲ http://192.168.x.x:PORT                                    │
└────────┼────────────────────────────────────────────────────────────┘
         │
    Phone / tablet (fetch /api/*)
```

## Package Structure

```
packages/
  frontend/                    ← UNCHANGED — LAN panel (zero-build HTML/CSS/JS)
    app.js / style.css / sw.js / manifest.json

  desktop/
    src/                       ← NEW — Svelte admin SPA source
      lib/
        invoke.ts              # typed invoke() wrappers
        types.ts               # StreamDeckConfig, Profile, VersionInfo
      components/
        GridEditor.svelte
        ButtonEditor.svelte
        ProfileSelector.svelte
        ActionSidebar.svelte
      App.svelte
      main.ts
    index.html
    vite.config.ts             # outDir → src-tauri/frontend/dist
    svelte.config.js
    package.json               # add: svelte, vite, @tauri-apps/api

    src-tauri/
      src/
        app.rs                 ← REFACTOR (remove sidecar, add QR window)
        lib.rs / main.rs
        commands/              ← NEW
          mod.rs
          config.rs            # Tauri commands: get_config, save_config,
                               #   get_default_config, list/create/activate/
                               #   rename/delete_profile, open_config_folder
          system.rs            # Tauri commands: execute_command, open_app,
                               #   open_url
          version.rs           # Tauri command: get_version_info (1hr cache)
        server/                ← NEW
          mod.rs               # Axum startup, port resolution
          routes.rs            # HTTP handlers (mirrors all current Hono routes)
          state.rs             # AppState definition + config/version helpers
      frontend/
        dist/                  ← Vite build output (gitignored)
        apps/                  ← NOT a real dir; include_dir! embeds packages/frontend/
                               #   at Rust compile time, no file copy needed
      Cargo.toml               ← add: axum, tokio, toml, serde_json,
                               #        reqwest, semver, include_dir
      tauri.conf.json          ← remove externalBin, frontendDist → "frontend/dist"

  backend/                     ← DELETE entirely
```

## Rust Modules

### Shared State (`server/state.rs`)

```rust
pub struct AppState {
    pub config_dir: PathBuf,                      // ~/.panna-cotta/
    pub version_cache: Mutex<Option<VersionCache>>,
    pub port: Mutex<Option<u16>>,
}
```

Config is always read from disk on demand — no in-memory copy. Files are small; this avoids stale-cache bugs.

### Tauri Commands

| Module | Commands |
|--------|----------|
| `commands/config.rs` | `get_config`, `save_config`, `get_default_config`, `list_profiles`, `create_profile`, `activate_profile`, `rename_profile`, `delete_profile`, `open_config_folder` |
| `commands/system.rs` | `execute_command(action, target)`, `open_app(name)`, `open_url(url)` |
| `commands/version.rs` | `get_version_info()` |
| `commands/server.rs` | `get_server_info()` → returns `{ ip: String, port: u16 }` from state |

All commands receive `State<Arc<AppState>>` from Tauri.

### Axum HTTP Server (`server/`)

Port resolution: try saved `~/.panna-cotta.port`, scan 30000–39999 if unavailable. Port written to state immediately on bind (no polling needed). Server spawned via `tauri::async_runtime::spawn()`.

Routes expose identical API surface to current Hono server:

```
GET  /                         QR setup page (inline HTML)
GET  /apps  →  /apps/          redirect
GET  /apps/*                   embedded packages/frontend/ via include_dir!
GET  /api/config               
PUT  /api/config               
GET  /api/config/default       
GET  /api/profiles             
POST /api/profiles             
POST /api/profiles/:name/activate
PATCH   /api/profiles/:name    
DELETE  /api/profiles/:name    
POST /api/execute              
POST /api/open-app             
POST /api/open-url             
POST /api/open-config-folder   
GET  /api/version              
GET  /api/check-update         
GET  /api/health               
```

Route handlers call the same underlying functions as Tauri commands — no logic duplication.

## Svelte Admin UI

### Components

- **`App.svelte`** — root; loads profiles + config on mount; owns reactive state
- **`ProfileSelector.svelte`** — dropdown, new/rename/delete inline controls
- **`GridEditor.svelte`** — visual grid preview, slot selection, highlights active slot
- **`ButtonEditor.svelte`** — name/type/icon/action fields; save/update/delete/clear
- **`ActionSidebar.svelte`** — searchable action templates, click to prefill editor

### IPC Layer (`lib/invoke.ts`)

Typed wrappers over `@tauri-apps/api/core` `invoke`. One file to change if command signatures shift:

```ts
import { invoke } from '@tauri-apps/api/core'
import type { StreamDeckConfig, Profile, VersionInfo } from './types'

export const getConfig = () => invoke<StreamDeckConfig>('get_config')
export const saveConfig = (config: StreamDeckConfig) => invoke('save_config', { config })
export const listProfiles = () => invoke<Profile[]>('list_profiles')
export const createProfile = (name: string) => invoke('create_profile', { name })
export const activateProfile = (name: string) => invoke('activate_profile', { name })
export const renameProfile = (oldName: string, newName: string) =>
  invoke('rename_profile', { oldName, newName })
export const deleteProfile = (name: string) => invoke('delete_profile', { name })
export const openConfigFolder = () => invoke('open_config_folder')
export const getVersionInfo = () => invoke<VersionInfo>('get_version_info')
export const executeCommand = (action: string, target: string) =>
  invoke('execute_command', { action, target })
```

### Admin Window

`app.rs` opens admin via `WebviewUrl::App(PathBuf::from("index.html"))` — no HTTP involved. The LAN frontend (`packages/frontend/app.js`) is **not changed** — it keeps `fetch('/api/...')` for phones.

## QR Window

A static `qr.html` bundled in `frontend/dist/`. Tray "Show QR" item opens a 300×400 Tauri window at `tauri://localhost/qr.html`. The page calls a `get_server_info` Tauri command (returns local IP + current port from state) and renders a QR image via `api.qrserver.com`.

## Removed

| Item | Reason |
|------|--------|
| `packages/backend/` | All logic moves to Rust |
| `src-tauri/binaries/` | No sidecar |
| `tauri_plugin_shell` | Only needed for sidecar spawn — `tauri_plugin_autostart` is kept (Launch at Login still needed) |
| Port polling loop in `app.rs` | Port known immediately when Axum binds |
| Deno compile tasks in `deno.json` | No Deno runtime |
| `beforeBuildCommand` sidecar compile | Replaced by Vite build |

## Migration Order

Each step leaves the app in a buildable state:

1. Add Cargo deps; scaffold `commands/` and `server/` with stub `todo!()` implementations
2. Port config logic to Rust (`commands/config.rs` + `server/state.rs`); add Rust tests
3. Port system commands and version check
4. Stand up Axum server; verify LAN access with a phone
5. Scaffold Svelte + Vite in `packages/desktop/src/`; build admin UI components
6. Switch admin window to `WebviewUrl::App`; verify `invoke()` calls work end-to-end
7. Delete `packages/backend/`; remove sidecar from `tauri.conf.json`
8. Add QR tray window (`qr.html` + `get_server_info` command)
9. Update CI/release workflow — remove Deno compile steps, add Vite build step

## New Cargo Dependencies

| Crate | Purpose |
|-------|---------|
| `axum` | Embedded HTTP server |
| `tokio` | Async runtime (Tauri already pulls this) |
| `toml` | TOML parse + serialize |
| `serde` + `serde_json` | Serialization |
| `reqwest` | GitHub API version check |
| `semver` | Version comparison |
| `include_dir` | Embed `packages/frontend/` in binary |

## Build Command (after migration)

```bash
cd packages/desktop
npm run tauri build
```

Vite builds Svelte → Cargo compiles Rust (embeds LAN frontend) → Tauri bundles `.app` / `.dmg` / `.exe`. No Deno required anywhere in the pipeline.
