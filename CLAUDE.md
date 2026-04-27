# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Behavioral Rules (Always Enforced)

- Do what has been asked; nothing more, nothing less
- NEVER create files unless they're absolutely necessary for achieving your goal
- ALWAYS prefer editing an existing file to creating a new one
- NEVER proactively create documentation files (*.md) or README files unless explicitly requested
- NEVER save working files, text/mds, or tests to the root folder
- Never continuously check status after spawning a swarm — wait for results
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files
- ALWAYS consider cross-platform compatibility for any native OS function (file paths, env vars, process APIs, shell commands) — support macOS, Linux, and Windows unless explicitly told otherwise

## Commands

```bash
# Run backend (dev)
deno task start:backend

# Run backend with auto-reload
deno task start:backend:watch

# Run tests
deno task test

# Run a single test file
deno test --config packages/backend/deno.json --allow-read --allow-env --allow-net --allow-run --allow-sys packages/backend/services/config_test.ts

# Lint
deno task lint

# Format
deno task fmt

# Compile standalone binary
deno task compile

# Compile Tauri sidecar binaries
deno task compile:sidecar:macos-arm    # Apple Silicon
deno task compile:sidecar:macos-x64   # Intel Mac
deno task compile:sidecar:windows-x64 # Windows
```

ALWAYS run `deno task test` after making backend changes. ALWAYS verify lint passes before committing.

## Architecture

Panna Cotta is a web-based Stream Deck: a Deno/Hono backend serves a plain HTML/CSS/JS frontend that renders a configurable button grid. Clicking a button calls the backend API, which uses macOS system commands (`open`, `osascript`) to launch apps or open URLs.

### Package Structure

```
packages/
  backend/
    server.ts              # Hono app, API routes, port resolution, landing page HTML
    services/
      config.ts            # c12 TOML loader + Zod validation → StreamDeckConfig
      system.ts            # Deno.Command wrappers for macOS (open, osascript, pmset)
      version.ts           # GitHub Releases API check with 1-hour cache
  frontend/
    app.js                 # Stream Deck UI: grid render, swipe pagination, view toggle
    style.css              # CSS variables for dark/light theme
    sw.js                  # Service worker: cache-first, skips /api/*
    manifest.json          # PWA manifest
  desktop/
    src-tauri/
      src/app.rs           # Tauri v2: tray menu, sidecar spawn, port polling, window
      tauri.conf.json      # Tauri config; sidecar declared as externalBin
stream-deck.config.toml    # User button config (read from cwd at runtime)
deno.json                  # Root tasks and import map
```

### Key Design Decisions

**Port persistence**: Backend picks a free port in 30000–39999, writes it to `~/.panna-cotta.port`. On restart, it tries the saved port first. The Tauri desktop app reads this file to poll server status.

**Frontend is zero-build**: Plain HTML/CSS/JS — no bundler. Backend embeds and serves `packages/frontend/` as static files via `serveDir`. In the compiled binary, frontend assets are embedded at compile time with `--include packages/frontend`.

**Sidecar pattern**: The Tauri desktop app compiles the Deno backend to a native binary (`stream-backend-<target>`), places it in `src-tauri/binaries/`, and spawns it as a Tauri sidecar. Tauri manages the process lifecycle.

**Config loading**: `c12` reads `stream-deck.config.toml` from `cwd`. Config is validated with Zod on every `/api/config` GET. The admin UI at `/admin` PUTs validated JSON back, which the backend serializes to TOML via `@std/toml`.

**Routes**:
- `/` — setup page with QR code (points to `/apps` on local network IP)
- `/apps/*` — static frontend files
- `/admin` — inline admin UI for editing config
- `/api/config` GET/PUT — config CRUD
- `/api/execute` POST — macOS command dispatcher (open-app, system-volume, brightness)
- `/api/open-app` POST, `/api/open-url` POST — direct app/URL launchers
- `/api/version` GET — current + latest version with update check
- `/api/check-update` GET — proxies GitHub Releases API

### Tauri Desktop App

- Tray icon spawns sidecar on startup, polls `~/.panna-cotta.port` every 500ms
- Tray menu: Open window, Port/status display, Start/Stop toggle, Launch at Login, Quit
- Window (`main`) is hidden by default; left-click tray icon or "Open" to show
- Window close hides rather than destroys (prevents_close + hide)
- macOS activation policy: `Accessory` (no Dock icon)

### Releases

Tagged commits (`v*`) trigger GitHub Actions to build standalone binaries for Linux x86_64, macOS Intel, macOS Apple Silicon, and Tauri `.dmg`/`.exe` installers.

## Project Config (RuFlo V3)

- **Topology**: hierarchical-mesh
- **Max Agents**: 15
- **Memory**: hybrid
- **HNSW**: Enabled
- **Neural**: Enabled

### Concurrency: 1 MESSAGE = ALL RELATED OPERATIONS

- All operations MUST be concurrent/parallel in a single message
- ALWAYS spawn ALL agents in ONE message with full instructions via Agent tool
- ALWAYS batch ALL file reads/writes/edits in ONE message
- ALWAYS batch ALL Bash commands in ONE message
- ALWAYS use `run_in_background: true` for all Agent tool calls
- After spawning agents, STOP — do NOT add more tool calls or check status

### Swarm Init

```bash
npx @claude-flow/cli@latest swarm init --topology hierarchical --max-agents 8 --strategy specialized
```
