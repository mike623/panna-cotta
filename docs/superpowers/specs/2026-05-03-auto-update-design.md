# Auto-Update Design

**Date:** 2026-05-03  
**Status:** Approved

## Summary

Add native auto-update to the Panna Cotta desktop app using `tauri-plugin-updater`. Updates download silently in the background. When ready, a native OS dialog prompts "Restart to update?" Users can also trigger a manual check via the macOS app menu.

## Requirements

- Check for updates on launch and every hour (background tokio interval)
- Auto-download silently when update found
- Native `dialog::ask` restart prompt after download completes
- "Check for Updates…" item in macOS app menu (not tray)
- If no update found on manual check: show `dialog::message("You're up to date (vX.X.X)")`
- If update already downloaded when manual check triggered: skip download, go straight to restart dialog

## Architecture

```
App startup
  └─ spawn tokio task: check_for_updates()
       └─ loop: check now → wait 1hr → repeat

macOS App Menu
  └─ "Check for Updates…" → invoke check_for_updates() immediately

check_for_updates()
  └─ tauri_plugin_updater::check()
       ├─ no update → silent (or "up to date" dialog if manual)
       └─ update found → auto download (background, silent)
            └─ download complete → dialog::ask("Restart to update?")
                 ├─ Yes → update.install() → relaunch()
                 └─ No  → update staged, prompt again next check
```

## Update Endpoint

```
https://github.com/mike623/panna-cotta/releases/latest/download/latest.json
```

Tauri generates `latest.json` automatically when `bundle.createUpdaterArtifacts: true`. No separate server needed.

## Components Changed

### Rust

| File | Change |
|------|--------|
| `Cargo.toml` | Add `tauri-plugin-updater`, `tauri-plugin-dialog`, `tauri-plugin-process` |
| `app.rs` | Register plugins, spawn background update loop, add macOS app menu |
| `commands/updater.rs` | New — `check_for_updates` Tauri command + shared update logic |

### Config

| File | Change |
|------|--------|
| `tauri.conf.json` | Add `bundle.createUpdaterArtifacts: true`, `plugins.updater` with pubkey + endpoint |
| `capabilities/default.json` | Add `updater:default`, `dialog:default`, `process:allow-restart` |

### CI

| File | Change |
|------|--------|
| `.github/workflows/tauri_release.yml` | Pass `TAURI_SIGNING_PRIVATE_KEY` env var to build step; upload `latest.json` to release |

## One-Time Setup (local, before implementation)

1. `npm run tauri signer generate -- -w ~/.tauri/panna-cotta.key`
2. Copy public key output → `tauri.conf.json` `plugins.updater.pubkey`
3. Add private key as GitHub Secret `TAURI_SIGNING_PRIVATE_KEY`

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Network down / GitHub unreachable | Silent, retry next interval |
| Download interrupted | Plugin discards partial, no prompt |
| User declines restart | Update staged on disk, re-prompt on next check |
| Signing mismatch | Plugin rejects silently (security guarantee) |
| Duplicate manual trigger while check in progress | Debounce — ignore |

## Out of Scope

- Existing `version.rs` / `/api/check-update` HTTP API — unchanged (used by LAN clients)
- Windows auto-update — CI builds `.exe` with `.sig`, plugin handles it, but not explicitly tested
- Delta updates — full installer only
