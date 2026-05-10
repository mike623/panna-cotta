# Changelog

All notable changes to Panna Cotta are documented here.

## [0.2.0.0] - 2026-05-10

### Added
- Plugin admin UI: ActionSidebar now loads plugins dynamically via `list_plugins` Tauri command — live status badges show running/starting/errored/stopped state for each plugin
- ButtonEditor now detects plugin actions and renders a Property Inspector iframe (PI) when available, falling back to a JSON settings editor for plugins without a PI
- `PropertyInspectorPath` field added to plugin manifest `Action` schema and exposed via `/api/plugins` HTTP route and `list_plugins_cmd` Tauri command
- Property Inspector HTML files served with Content-Security-Policy header restricting script and connection sources to `127.0.0.1`

### Fixed
- Volume mute action now toggles mute on/off correctly (was using invalid AppleScript syntax `set volume with output muted`; now uses `set volume output muted not (output muted of (get volume settings))`)
- `PropertyInspectorPath` in plugin manifests is now validated for path traversal (`..`) and absolute paths at load time, matching the existing `CodePath` security checks
- Property Inspector iframe sandbox now includes `allow-same-origin` so PI scripts can make HTTP requests to the local Panna Cotta server

## [0.1.11] - 2026-05-04

### Added
- Version number displayed in Settings popover (gear icon)

## [0.1.10] - 2026-05-03

### Removed
- Update available banner on phone/tablet panel — desktop app handles updates natively
- `/api/version` HTTP endpoint (no longer needed)
- Dead code: `VersionInfo`, `VersionCache` structs, `version_cache` state, `commands/version.rs`
- `reqwest` and `semver` dependencies from Cargo.toml

## [0.1.9] - 2026-05-03

### Fixed
- QR code in Connect popover now generates a real, scannable code (was a fake procedural pattern)

## [0.1.8] - 2026-05-03

### Added
- Admin panel redesigned with glassmorphic React UI: drag-and-drop slot management, multi-profile support, multi-page layouts, undo/redo (50 snapshots), debounced autosave
- Command palette (⌘K) with search across actions and commands
- Settings popover in toolbar: server port/status indicator, Launch at Login toggle, Quit button
- 54 stroke-based SVG icons including power and settings icons
- Dark/light theme toggle with oklch color system and glassy aesthetics
- Keyboard shortcuts overlay (?) and slot selection by number key

### Changed
- Tray icon click now opens admin panel directly — no more context menu
- All admin settings (autostart, quit) moved into the admin panel settings popover
- Admin window is now fixed size (non-resizable), fits content without scrolling

### Fixed
- Quit button now correctly terminates the app (added `process:allow-exit` capability)
- Admin window no longer scrollable — layout fills the fixed window

## [0.1.7] - 2026-05-03

### Added
- Native auto-update with background download and restart dialog
- Signed multi-platform release builds via GitHub Actions

## [0.1.6] - 2026-04-28

### Fixed
- Configuration file path now correctly uses user home directory
- Deno lint errors in version sync script resolved

## [0.1.5] - 2026-04-28

### Fixed
- Lint and format issues resolved across codebase

## [0.1.4] - 2026-04-28

### Fixed
- Configuration path fix: profiles now stored in correct user home directory

## [0.1.3] - 2026-04-28

### Added
- Version display in Tauri tray menu

## [0.1.2] - 2026-04-28

### Fixed
- App quit behavior from tray menu
- Version badge display
