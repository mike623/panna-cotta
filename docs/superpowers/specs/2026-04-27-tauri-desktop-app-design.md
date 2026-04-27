# Tauri Desktop App — Design Spec

**Date:** 2026-04-27  
**Status:** Approved

## Goal

Wrap panna-cotta (Deno backend + web frontend) in a native macOS/Windows menu bar app using Tauri. No terminal required. Users launch the app, it lives in the system tray, and clicking opens a floating window.

## Architecture

```
panna-cotta/
├── packages/
│   ├── backend/          (existing Deno server — unchanged)
│   ├── frontend/         (existing web UI — unchanged)
│   └── desktop/          (new Tauri app)
│       ├── src-tauri/
│       │   ├── src/main.rs       (tray, sidecar spawn, window)
│       │   ├── Cargo.toml
│       │   └── tauri.conf.json
│       └── package.json
```

## Data Flow

```
User launches .app / .exe
  → Tauri starts
  → spawns stream-backend sidecar (deno compiled binary)
  → sidecar picks port, writes port file (existing behavior)
  → Tauri polls port file to read PORT
  → user clicks tray icon → floating window opens at localhost:PORT
  → user clicks tray again or presses Esc → window hides (not quit)
```

## Sidecar

- Built via existing `deno compile` task → `stream-backend` binary
- Registered in `tauri.conf.json` as an allowed sidecar
- Tauri spawns it on app start, monitors process health
- On crash: tray updates to `○ Stopped [Start]`, no silent failure

## Tray Menu

```
Panna Cotta
──────────────
Open
──────────────
Port: 31234
● Running  [Stop]
──────────────
Launch at Login  ✓
──────────────
Quit
```

When server stopped:
```
Port: 31234
○ Stopped  [Start]
```

- **Port** — read from port file, updates dynamically
- **Running/Stopped** — reflects sidecar process state
- **Start/Stop** — spawns or kills sidecar process
- **Launch at Login** — checkbox, opt-in (disabled by default)

## Window

- Floating window, not docked to menu bar
- Opens at `localhost:PORT`
- Hides on second tray click or Esc — does not quit
- No title bar / minimal chrome

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Sidecar crash | Tray → `○ Stopped [Start]` |
| Port file missing on start | Retry 3x / 500ms, then `○ Stopped` |
| Window fails to load | Error page with retry button |

## GHA Release

```
push tag
  → build sidecar: deno compile → stream-backend binary
  → tauri build (bundles sidecar)
  → upload .dmg (macOS) + .exe installer (Windows) to GH release
```

No code signing in initial release. Unsigned artifacts — users remove quarantine manually (`xattr -d com.apple.quarantine`) or approve via Gatekeeper dialog.

## Out of Scope (v1)

- Code signing / notarization
- Linux support
- Auto-update from within the app
- Multiple server instances
