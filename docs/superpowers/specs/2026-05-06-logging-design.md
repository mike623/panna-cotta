# Logging System Design

## Overview

File-based rolling log system using the standard Rust `tracing` ecosystem. Logs write to `~/.panna-cotta/logs/panna-cotta.log` with daily rotation. Admin UI gains an "Open Logs" button in the gear settings popover.

## Architecture

### Rust Backend

**Dependencies added to `Cargo.toml`:**
- `tracing` — logging facade (macros: `info!`, `warn!`, `error!`, `debug!`)
- `tracing-subscriber` — formats and filters log output
- `tracing-appender` — rolling file appender

**Initialization in `lib.rs`** (before Tauri setup):
- Create `~/.panna-cotta/logs/` directory if missing
- Build a daily-rolling `NonBlocking` appender writing to `panna-cotta.log`
- Keep 7 archived files (`tracing_appender::rolling::daily`)
- Format: `2026-05-06T22:15:33Z  INFO panna_cotta::server: started on port 31234`
- In debug builds, also log to stderr via `with_writer(writer.and(std::io::stderr))`
- Set default filter: `info` (configurable via `RUST_LOG` env var)

**New Tauri command `open_log_folder`** in `commands/system.rs`:
- Opens `~/.panna-cotta/logs/` in Finder (macOS: `open <path>`)
- Cross-platform: `start` on Windows, `xdg-open` on Linux
- Registered in `app.rs` invoke handler

### Instrumentation Points

| File | What is logged |
|------|---------------|
| `app.rs` | App start (version), update check triggered |
| `server/mod.rs` | Server start with port, server error |
| `server/routes.rs` | Every button dispatch: action UUID, target, ok/err result |
| `server/state.rs` | Config load/save, profile create/activate/rename/delete |
| `commands/config.rs` | Tauri-side profile CRUD commands |
| `commands/system.rs` | execute_command, open_app, open_url — log action + result |

### Frontend

In `SettingsPopover` (`ui.tsx`), add a new row:

```
Open Logs   [→ icon button]
```

Clicking calls `invoke('open_log_folder')`. No new state required. Placed in the bottom section above Quit.

## Log Format Example

```
2026-05-06T22:15:30Z  INFO panna_cotta: starting v0.1.11
2026-05-06T22:15:31Z  INFO panna_cotta::server: bound to port 31452
2026-05-06T22:15:45Z  INFO panna_cotta::server::routes: button press action=com.pannacotta.system.open-app target=Safari ok
2026-05-06T22:15:46Z ERROR panna_cotta::server::routes: button press action=com.pannacotta.system.execute target=brightness err=command not found
2026-05-06T22:16:10Z  INFO panna_cotta::server::state: config saved profile=Default
```

## Files Changed

- `Cargo.toml` — add tracing deps
- `src/lib.rs` — init logging subscriber
- `src/app.rs` — log app start, register `open_log_folder`
- `src/server/mod.rs` — log server bind
- `src/server/routes.rs` — log button dispatches
- `src/server/state.rs` — log config/profile ops
- `src/commands/system.rs` — add `open_log_folder`, add tracing to existing commands
- `src/commands/config.rs` — add tracing to profile commands
- `packages/desktop/src/ui.tsx` — add "Open Logs" row to SettingsPopover
