# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Behavioral Rules (Always Enforced)

- Do what has been asked; nothing more, nothing less
- NEVER create files unless they're absolutely necessary for achieving your goal
- ALWAYS prefer editing an existing file to creating a new one
- NEVER proactively create documentation files (*.md) or README files unless
  explicitly requested
- NEVER save working files, text/mds, or tests to the root folder
- Never continuously check status after spawning a swarm — wait for results
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files
- ALWAYS consider cross-platform compatibility for any native OS function (file
  paths, env vars, process APIs, shell commands) — support macOS, Linux, and
  Windows unless explicitly told otherwise

## Commands

All `npm` scripts live in `packages/desktop`; all `cargo` commands in
`packages/desktop/src-tauri`. There is no root build — the root `package.json`
only holds `release-it`.

```bash
# Dev (Vite dev server on :1420 + Tauri hot-reload)
cd packages/desktop && npm run tauri dev

# Production build (.dmg / .app)
cd packages/desktop && npm run tauri build

# Admin SPA build only (Vite → src-tauri/frontend/dist)
cd packages/desktop && npm run build

# React unit tests (Vitest)
cd packages/desktop && npm test
cd packages/desktop && npx vitest run src/__tests__/<file>.test.tsx   # single file
cd packages/desktop && npx vitest run -t "<test name>"                # single test

# E2E (Playwright). e2e/ mocks the Tauri backend; e2e-lan/ drives the real LAN server.
cd packages/desktop && npm run test:e2e
cd packages/desktop && npm run test:e2e-lan

# Smoke (WebdriverIO + tauri-driver)
cd packages/desktop && npm run smoke

# Rust
cd packages/desktop/src-tauri && cargo test
cd packages/desktop/src-tauri && cargo check
cd packages/desktop/src-tauri && cargo clippy
```

ALWAYS run `cargo test` after making Rust backend changes. ALWAYS run
`cargo check` before committing.

## Architecture

Panna Cotta is a native Tauri (macOS-first) desktop app that turns a phone or
tablet into a wireless control panel. It is, in effect, **a host for Elgato
Stream Deck plugins**: it loads real `.sdPlugin` bundles, drives them over the
Stream Deck WebSocket protocol, and surfaces their actions on a web panel
served to LAN devices. An embedded Axum HTTP server serves both the panel and
a JSON/SSE API; the admin UI is a React SPA in a native Tauri webview.

### Package Structure

```
packages/
  frontend/                # LAN panel — vanilla JS PWA (phones/tablets)
    app.js  style.css  sw.js  manifest.json
  desktop/
    src/                   # React 18 admin SPA (Vite)
      main.tsx             # entry
      PannaApp.tsx         # root: loads config/profiles/server-info via IPC
      core.tsx  ui.tsx     # grid editor, palettes, ConnectPopover, toolbar
      data.ts  theme.ts  bridge.ts  icons.tsx
      AutocompleteSettings.tsx
      lib/{invoke,types,useHistory}.ts   # typed IPC wrappers + shared types
      __tests__/           # Vitest, with mocked Tauri invoke (mocks/tauriInvoke.ts)
    e2e/  e2e-lan/  smoke/  # Playwright (mocked + real LAN) and WDIO suites
    src-tauri/
      src/
        app.rs             # Tauri builder: tray, menu, windows, command registry,
                           #   logging, crash handlers, deep-link, startup sequence
        server/
          mod.rs           # port resolution (30000-39999), start(), post_start_spawn(),
                           #   built-in plugin copy-out
          routes.rs        # all Axum HTTP handlers + CSRF middleware + QR page
          state.rs         # AppState, config/profile CRUD, legacy→UUID migration
          mdns.rs          # mDNS/Bonjour advertise (_pannacotta._tcp.local.)
        plugin/            # Stream Deck plugin HOST
          mod.rs           # PluginHost: process lifecycle, crash supervision
          discovery.rs     # scan ~/.panna-cotta/plugins/*.sdPlugin → manifests
          manifest.rs      # manifest.json parsing
          runtime.rs       # Node.js binary resolution
          ws.rs            # /ws + /pi WebSocket upgrade (SD protocol)
        events/{inbound,outbound}.rs   # SD protocol ↔ Tauri events / config writes
        autocomplete/      # macOS Touch-Bar-style suggestion strip
          tap.rs           # CGEventTap keyboard monitor (macOS only)
          buffer.rs  spell.rs  state.rs
        commands/          # Tauri IPC commands (config, system, plugins,
                           #   autocomplete, updater, server_info, plugin_install)
      tauri.conf.json      # frontendDist=frontend/dist, devUrl=:1420, resources=plugins/
      Cargo.toml
```

### Key Design Decisions

**Stream Deck plugin host**: Installed plugins live in
`~/.panna-cotta/plugins/*.sdPlugin`. On startup (`post_start_spawn`) the host
discovers manifests, resolves a Node.js binary (`plugin/runtime.rs`), and
spawns each plugin as a child process that connects back over `/ws` speaking
the Elgato Stream Deck protocol. Plugins are crash-supervised: more than
`MAX_CRASHES` (5) within `CRASH_WINDOW` (60s) marks a plugin `Errored` instead
of restarting. Property Inspector HTML is served at `/pi/:uuid/*`. Built-in
plugins (e.g. Spotify) ship as Tauri `resources` and are copied into the config
dir on launch, refreshed when the bundled manifest `Version` changes.
Deep link `streamdeck://plugins/install?url=...` installs a plugin.

**Config is action-UUID based**: A `Button` (`server/state.rs`) has
`actionUUID`, a unique `context`, opaque `settings`, and optional `lanAllowed`.
Built-in actions use `com.pannacotta.*` UUIDs; plugin actions are routed by
UUID to the owning plugin via the host `registry`. Pre-UUID TOML configs are
migrated on read (`migrate_config_from_legacy`).

**Dual access + shared state**: `Arc<AppState>` is shared between Axum handlers
and Tauri commands; config is read from disk on demand (no stale in-memory
copy). Phones connect via `http://<ip-or-host.local>:PORT/apps/`; the admin
window loads `WebviewUrl::App("index.html")` (Vite dev server in `tauri dev`,
`frontendDist` in production). The LAN frontend in `packages/frontend/` is
embedded in the binary at compile time.

**CSRF / LAN trust boundary**: Mutating admin routes sit behind a
`require_admin` middleware checking the `X-Panna-CSRF` header against
`state.csrf_token` (the SPA fetches it via `get_csrf_token`). Read routes are
open to the LAN, but `GET /api/config` **strips each button's `settings`**
(may hold secrets) unless the caller is localhost AND presents a valid CSRF
token. When editing routes, preserve this: never leak `settings` to
unauthenticated LAN clients.

**macOS autocomplete tap**: A single app-lifetime `CGEventTap`
(`autocomplete/tap.rs`) watches typing and pushes suggestions to the panel over
SSE (`/api/autocomplete`). CGEventTap + WKWebView can deliver `SIGABRT` on
recent macOS, so the tap is **paused while the admin window is focused**
(`on_window_event` in `app.rs`); a SIGABRT handler logs this signature.

**Port persistence**: Axum picks a free port in 30000–39999 and writes it to
`~/.panna-cotta.port`, retrying the saved port first. `PANNA_CONFIG_DIR`
overrides the config dir (and port/CSRF-token files) for test isolation — when
set, `start()` writes `.csrf-token` into it so E2E harnesses can authenticate.

**Profiles**: Per-profile TOML in `~/.panna-cotta/profiles/*.toml`; active
profile in `~/.panna-cotta/active-profile`. Logs roll daily into
`~/.panna-cotta/logs/`.

**Key routes** (`server/routes.rs`): `GET /` QR/connect page · `GET /apps/*`
embedded panel · `GET|PUT /api/config` · `GET|POST /api/profiles`,
`POST /api/profiles/:name/activate`, `PATCH|DELETE /api/profiles/:name` ·
`POST /api/execute` action dispatcher · `GET|POST|DELETE /api/plugins...` ·
`GET /api/plugin-render`, `/pi/:uuid/*` · `GET /api/autocomplete` &
`/api/config/events` (SSE) · `GET /ws` (plugin protocol) · `GET /api/health`.

### Tauri Desktop App

- Tray icon (left-click opens the admin window); app menu has Check for Updates
  and a standard Edit submenu (required so WKWebView gets Cmd+C/V/X/A/Z).
- Single admin window `WebviewUrl::App("index.html")`; close hides, not destroys.
- macOS activation policy `Accessory` (no Dock icon).
- Auto-update: checks 5s after launch, then hourly (notify-only).

### Releases

Pushes to `main` that change the version files trigger GitHub Actions
(`.github/workflows`): CI extracts the version, creates+pushes the `v*` tag,
Vite builds the SPA, Cargo compiles Rust (embedding the LAN frontend + bundled
plugins), Tauri bundles a signed/notarized `.dmg`, and the Homebrew cask is
updated. Bump versions with `scripts/sync-versions.mjs <version>` (rewrites
both `package.json`s, `Cargo.toml`, and `tauri.conf.json` in one shot).
