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

```bash
# Dev (Vite + Tauri hot-reload)
cd packages/desktop && npm run tauri dev

# Production build
cd packages/desktop && npm run tauri build

# Rust tests
cd packages/desktop/src-tauri && cargo test

# Rust lint/check
cd packages/desktop/src-tauri && cargo check
cd packages/desktop/src-tauri && cargo clippy

# Svelte build only
cd packages/desktop && npm run build
```

ALWAYS run `cargo test` after making Rust backend changes. ALWAYS run
`cargo check` before committing.

## Architecture

Panna Cotta is a native Tauri desktop app (macOS-first) that acts as a
web-based Stream Deck. An embedded Axum HTTP server serves a plain HTML/JS
frontend to phones/tablets on the LAN. The admin UI is a Svelte SPA loaded in a
native Tauri webview.

### Package Structure

```
packages/
  frontend/
    app.js                 # Stream Deck UI (LAN panel for phones/tablets)
    style.css              # CSS variables for dark/light theme
    sw.js                  # Service worker
    manifest.json          # PWA manifest
  desktop/
    src/                   # Svelte admin SPA
      App.svelte           # Root component
      components/          # GridEditor, ButtonEditor, ProfileSelector, ActionSidebar
      lib/
        invoke.ts          # Typed Tauri IPC wrappers
        types.ts           # Shared TypeScript types
    public/
      qr.html              # QR code window (loaded by tray "Show QR" item)
    src-tauri/
      src/
        app.rs             # Tauri builder: tray, windows, command registration
        server/
          mod.rs           # Axum startup + port resolution (30000-39999)
          routes.rs        # All HTTP handlers (mirrors Tauri commands for LAN)
          state.rs         # AppState, profile CRUD, config read/write
        commands/
          config.rs        # Tauri commands: get/save config, profile CRUD
          system.rs        # Tauri commands: execute_command, open_app, open_url
          version.rs       # Tauri command: get_version_info (1hr cache)
          server_info.rs   # Tauri command: get_server_info (IP + port)
      tauri.conf.json      # Tauri config: frontendDist, devUrl, bundle
      Cargo.toml
```

### Key Design Decisions

**Dual access model**: Phones connect via `http://192.168.x.x:PORT/apps/` (Axum
server). Admin UI opens as a Tauri webview at `tauri://localhost/index.html`
(served from `frontendDist` in production, from Vite dev server in `tauri dev`).

**Shared state**: `Arc<AppState>` is shared between Axum route handlers and
Tauri commands. Config is always read from disk on demand — no stale in-memory
copy.

**Port persistence**: Axum picks a free port in 30000–39999, writes it to
`~/.panna-cotta.port`. On restart, it tries the saved port first.

**Embedded LAN frontend**: `packages/frontend/` is embedded in the binary at
compile time via `include_dir!("$CARGO_MANIFEST_DIR/../../frontend")`.

**Profile system**: Configs stored as per-profile TOML files in
`~/.panna-cotta/profiles/*.toml`. Active profile tracked in
`~/.panna-cotta/active-profile`.

**Routes**:

- `GET /` — QR setup page (LAN IP + port)
- `GET /apps/*` — embedded `packages/frontend/` static files
- `GET/PUT /api/config` — active profile config CRUD
- `GET /api/config/default` — default config
- `GET/POST /api/profiles` — list/create profiles
- `POST /api/profiles/:name/activate` — switch active profile
- `PATCH/DELETE /api/profiles/:name` — rename/delete profile
- `POST /api/execute` — macOS command dispatcher
- `POST /api/open-app`, `/api/open-url` — launchers
- `GET /api/version`, `/api/check-update` — version info
- `GET /api/health`

### Tauri Desktop App

- Tray icon starts Axum server on startup, updates port display when ready
- Tray menu: Open, Admin Config, Show QR Code, Port/status, Launch at Login, version, Quit
- Admin window uses `WebviewUrl::App("index.html")` — Svelte SPA
- Main window uses `WebviewUrl::External(http://localhost:PORT/apps/)` — LAN panel
- Window close hides rather than destroys
- macOS activation policy: `Accessory` (no Dock icon)

### Releases

Tagged commits (`v*`) trigger GitHub Actions: Vite builds Svelte, Cargo
compiles Rust (embeds LAN frontend), Tauri bundles `.dmg`/`.exe`.

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

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **panna-cotta** (729 symbols, 1219 relationships, 61 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/panna-cotta/context` | Codebase overview, check index freshness |
| `gitnexus://repo/panna-cotta/clusters` | All functional areas |
| `gitnexus://repo/panna-cotta/processes` | All execution flows |
| `gitnexus://repo/panna-cotta/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
