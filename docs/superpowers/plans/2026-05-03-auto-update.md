# Auto-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add silent background auto-update with a native restart dialog and a "Check for Updates…" macOS app menu item using `tauri-plugin-updater`.

**Architecture:** `tauri-plugin-updater` checks a `latest.json` hosted on GitHub releases. A tokio interval task checks on launch and every hour; a Tauri command handles manual checks from the macOS app menu. Signing is mandatory — CI injects the private key via GitHub Secret; the public key is baked into `tauri.conf.json`.

**Tech Stack:** Rust, Tauri v2, `tauri-plugin-updater`, `tauri-plugin-dialog`, `tauri-plugin-process`, GitHub Releases as update endpoint.

---

## File Map

| File | Action |
|------|--------|
| `packages/desktop/src-tauri/Cargo.toml` | Add 3 plugin deps |
| `packages/desktop/src-tauri/tauri.conf.json` | Add `createUpdaterArtifacts`, `plugins.updater` block |
| `packages/desktop/src-tauri/capabilities/default.json` | Add 3 permissions |
| `packages/desktop/src-tauri/src/commands/updater.rs` | **Create** — update logic |
| `packages/desktop/src-tauri/src/commands/mod.rs` | Add `pub mod updater` |
| `packages/desktop/src-tauri/src/app.rs` | Register plugins, app menu, background loop, fix invoke_handler |
| `packages/desktop/src-tauri/src/commands/version.rs` | Remove `get_version_info` Tauri command |
| `packages/desktop/src-tauri/src/server/routes.rs` | Remove `/api/check-update` route + handler |
| `packages/desktop/src/lib/invoke.ts` | Remove `getVersionInfo` |
| `packages/desktop/src/lib/types.ts` | Remove `VersionInfo` |
| `.github/workflows/tauri_release.yml` | Add signing env var + `latest.json` upload |

---

## Task 1: One-Time Signing Key Setup

**Files:** `packages/desktop/src-tauri/tauri.conf.json` (pubkey placeholder for now)

> This task is manual and must be done before any CI builds will produce valid update artifacts. The private key must never be committed.

- [ ] **Step 1: Generate the keypair**

```bash
cd packages/desktop
npx tauri signer generate -- -w ~/.tauri/panna-cotta.key
```

Expected output — something like:
```
Please remember to store the private key path securely.
Public key: dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk...
Private key saved to /Users/<you>/.tauri/panna-cotta.key
```

- [ ] **Step 2: Copy the public key string**

The public key is the long base64 string printed after `Public key:`. Copy it — you will paste it into `tauri.conf.json` in Task 3.

- [ ] **Step 3: Save the private key as a GitHub Secret**

Go to: `https://github.com/mike623/panna-cotta/settings/secrets/actions`

Create secret named `TAURI_SIGNING_PRIVATE_KEY`. Value: the content of `~/.tauri/panna-cotta.key` (the full file content, including header lines).

> **Warning:** If this private key is lost, existing installs can never receive auto-updates again. Keep a secure backup (password manager, etc.).

- [ ] **Step 4: No commit needed for this task** — the key file stays local, the secret is in GitHub.

---

## Task 2: Add Cargo Dependencies

**Files:**
- Modify: `packages/desktop/src-tauri/Cargo.toml`

- [ ] **Step 1: Add the three plugin crates to `[dependencies]`**

Open `packages/desktop/src-tauri/Cargo.toml`. In the `[dependencies]` block, add after the `tauri-plugin-autostart` line:

```toml
tauri-plugin-updater = "2"
tauri-plugin-dialog = "2"
tauri-plugin-process = "2"
```

- [ ] **Step 2: Verify it compiles**

```bash
cd packages/desktop/src-tauri && cargo check
```

Expected: no errors (warnings about unused imports are OK at this stage).

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src-tauri/Cargo.toml
git commit -m "chore: add tauri-plugin-updater, dialog, process dependencies"
```

---

## Task 3: Configure tauri.conf.json and Capabilities

**Files:**
- Modify: `packages/desktop/src-tauri/tauri.conf.json`
- Modify: `packages/desktop/src-tauri/capabilities/default.json`

- [ ] **Step 1: Update `tauri.conf.json`**

Add `createUpdaterArtifacts` to the `bundle` section and add a `plugins` block. Replace the `bundle` and root-level sections so the file becomes:

```json
{
  "productName": "Panna Cotta",
  "version": "0.1.6",
  "identifier": "io.mwong.panna-cotta",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "frontend/dist"
  },
  "app": {
    "withGlobalTauri": true,
    "windows": [],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "createUpdaterArtifacts": true,
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  },
  "plugins": {
    "updater": {
      "pubkey": "PASTE_PUBLIC_KEY_HERE",
      "endpoints": [
        "https://github.com/mike623/panna-cotta/releases/latest/download/latest.json"
      ]
    }
  }
}
```

Replace `PASTE_PUBLIC_KEY_HERE` with the public key string from Task 1 Step 2.

- [ ] **Step 2: Update `capabilities/default.json`**

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "default capability",
  "windows": ["main", "admin"],
  "permissions": [
    "core:default",
    "autostart:allow-enable",
    "autostart:allow-disable",
    "autostart:allow-is-enabled",
    "updater:default",
    "dialog:default",
    "process:allow-restart"
  ]
}
```

- [ ] **Step 3: Verify**

```bash
cd packages/desktop/src-tauri && cargo check
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src-tauri/tauri.conf.json packages/desktop/src-tauri/capabilities/default.json
git commit -m "feat: configure tauri updater plugin — endpoint, pubkey, capabilities"
```

---

## Task 4: Create commands/updater.rs

**Files:**
- Create: `packages/desktop/src-tauri/src/commands/updater.rs`

- [ ] **Step 1: Create the file with full update logic**

```rust
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_updater::UpdaterExt;

static IS_CHECKING: AtomicBool = AtomicBool::new(false);

pub async fn run_update_check(app: AppHandle, manual: bool) {
    if IS_CHECKING.swap(true, Ordering::SeqCst) {
        return;
    }
    do_check(&app, manual).await;
    IS_CHECKING.store(false, Ordering::SeqCst);
}

async fn do_check(app: &AppHandle, manual: bool) {
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            eprintln!("Updater init error: {e}");
            return;
        }
    };

    match updater.check().await {
        Ok(Some(update)) => {
            if let Err(e) = update.download_and_install(|_, _| {}, || {}).await {
                eprintln!("Update install failed: {e}");
                return;
            }
            let restart = app
                .dialog()
                .message("A new version has been installed. Restart now?")
                .title("Update Ready")
                .ok_button_label("Restart Now")
                .cancel_button_label("Later")
                .blocking_show();
            if restart {
                app.restart();
            }
        }
        Ok(None) => {
            if manual {
                let version = app.package_info().version.to_string();
                app.dialog()
                    .message(format!("You're up to date (v{version})"))
                    .title("No Updates Available")
                    .blocking_show();
            }
        }
        Err(e) => {
            eprintln!("Update check failed: {e}");
        }
    }
}

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) {
    run_update_check(app, true).await;
}
```

- [ ] **Step 2: Add module to `commands/mod.rs`**

Open `packages/desktop/src-tauri/src/commands/mod.rs` and add:

```rust
pub mod config;
pub mod server_info;
pub mod system;
pub mod updater;
pub mod version;
```

- [ ] **Step 3: Verify it compiles**

```bash
cd packages/desktop/src-tauri && cargo check
```

Expected: no errors. If `app.restart()` is not found on `AppHandle`, add `use tauri_plugin_process::AppHandleExt;` to the top of `updater.rs`.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src-tauri/src/commands/updater.rs packages/desktop/src-tauri/src/commands/mod.rs
git commit -m "feat: add updater command with background check and restart dialog"
```

---

## Task 5: Wire Updater into app.rs

**Files:**
- Modify: `packages/desktop/src-tauri/src/app.rs`

- [ ] **Step 1: Add imports at the top of `app.rs`**

The current imports block is:
```rust
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, Wry,
};
use tauri_plugin_autostart::MacosLauncher;
use crate::server::state::AppState;
```

Replace with:
```rust
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, Wry,
};
use tauri_plugin_autostart::MacosLauncher;
use crate::server::state::AppState;
```

- [ ] **Step 2: Add `build_app_menu` function**

Add this function anywhere before `run()`:

```rust
fn build_app_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<Wry>> {
    let check_updates = MenuItemBuilder::new("Check for Updates\u{2026}")
        .id("check-for-updates")
        .build(app)?;
    let app_submenu = SubmenuBuilder::new(app, "Panna Cotta")
        .item(&check_updates)
        .build()?;
    MenuBuilder::new(app).item(&app_submenu).build()
}
```

- [ ] **Step 3: Update the `run()` function**

In `run()`, make these four changes:

**a) Register the three new plugins** — add after the autostart plugin line:

```rust
.plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![])))
.plugin(tauri_plugin_updater::Builder::new().build())
.plugin(tauri_plugin_dialog::init())
.plugin(tauri_plugin_process::init())
```

**b) Add `check_for_updates` to `invoke_handler!` and remove `get_version_info`:**

```rust
.invoke_handler(tauri::generate_handler![
    crate::commands::config::get_config,
    crate::commands::config::save_config,
    crate::commands::config::get_default_config,
    crate::commands::config::list_profiles_cmd,
    crate::commands::config::create_profile_cmd,
    crate::commands::config::activate_profile_cmd,
    crate::commands::config::rename_profile_cmd,
    crate::commands::config::delete_profile_cmd,
    crate::commands::config::open_config_folder,
    crate::commands::system::execute_command,
    crate::commands::system::open_app,
    crate::commands::system::open_url,
    crate::commands::updater::check_for_updates,
    crate::commands::server_info::get_server_info,
])
```

**c) Wire the app menu and its event handler** — add `.on_menu_event` and set the menu inside `.setup`:

Add `.on_menu_event` to the builder chain (before `.setup`):

```rust
.on_menu_event(|app, event| {
    if event.id().as_ref() == "check-for-updates" {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            crate::commands::updater::run_update_check(app, true).await;
        });
    }
})
```

**d) Inside `.setup`, after `build_tray(app.handle())?;`, set the app menu and spawn the background update loop:**

```rust
let app_menu = build_app_menu(app.handle())?;
app.set_menu(app_menu)?;

let update_handle = app.handle().clone();
tauri::async_runtime::spawn(async move {
    tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
    crate::commands::updater::run_update_check(update_handle.clone(), false).await;
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(3600));
    interval.tick().await;
    loop {
        interval.tick().await;
        crate::commands::updater::run_update_check(update_handle.clone(), false).await;
    }
});
```

- [ ] **Step 4: Verify**

```bash
cd packages/desktop/src-tauri && cargo check
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src-tauri/src/app.rs
git commit -m "feat: register updater plugins, add app menu, spawn background update loop"
```

---

## Task 6: Trim version.rs

**Files:**
- Modify: `packages/desktop/src-tauri/src/commands/version.rs`

- [ ] **Step 1: Remove the `get_version_info` Tauri command**

Delete the final function from `version.rs` — the `#[tauri::command]` wrapper. The file should end after `get_version_info_inner`. The last remaining content should be:

```rust
pub async fn get_version_info_inner(state: &AppState) -> Result<VersionInfo, String> {
    // ... existing body unchanged ...
}
```

Remove:
```rust
#[tauri::command]
pub async fn get_version_info(
    state: State<'_, Arc<AppState>>,
) -> Result<VersionInfo, String> {
    get_version_info_inner(&state).await
}
```

Also remove the now-unused import at the top:
```rust
use tauri::State;
```

- [ ] **Step 2: Verify**

```bash
cd packages/desktop/src-tauri && cargo check
```

Expected: no errors or warnings about unused imports.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src-tauri/src/commands/version.rs
git commit -m "chore: remove get_version_info Tauri command, keep inner fn for HTTP route"
```

---

## Task 7: Remove /api/check-update from routes.rs

**Files:**
- Modify: `packages/desktop/src-tauri/src/server/routes.rs`

- [ ] **Step 1: Remove the route registration (line 40)**

In `create_router`, delete this line:
```rust
        .route("/api/check-update", get(check_update_handler))
```

- [ ] **Step 2: Delete the `check_update_handler` function (lines 256–279)**

Delete the entire function:
```rust
async fn check_update_handler() -> impl IntoResponse {
    // ... all lines ...
}
```

- [ ] **Step 3: Verify**

```bash
cd packages/desktop/src-tauri && cargo check
```

Expected: no errors. Confirm the `reqwest` import in routes.rs is still used elsewhere (it is — `execute_handler` uses it). If any unused import warnings appear about types only used by `check_update_handler`, remove them.

- [ ] **Step 4: Run tests**

```bash
cd packages/desktop/src-tauri && cargo test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src-tauri/src/server/routes.rs
git commit -m "chore: remove unused /api/check-update route"
```

---

## Task 8: Clean Up TypeScript

**Files:**
- Modify: `packages/desktop/src/lib/invoke.ts`
- Modify: `packages/desktop/src/lib/types.ts`

- [ ] **Step 1: Remove `getVersionInfo` from `invoke.ts`**

Delete these two lines:
```typescript
export const getVersionInfo = () =>
  invoke<VersionInfo>('get_version_info')
```

Also remove `VersionInfo` from the import line at the top:
```typescript
import type { StreamDeckConfig, Profile, ServerInfo } from './types'
```

- [ ] **Step 2: Remove `VersionInfo` from `types.ts`**

Delete the `VersionInfo` interface:
```typescript
export interface VersionInfo {
  current: string
  latest: string | null
  updateAvailable: boolean
  releaseUrl: string | null
}
```

- [ ] **Step 3: Verify no Svelte component references VersionInfo**

```bash
grep -r "VersionInfo\|getVersionInfo" packages/desktop/src
```

Expected: no output (nothing uses it).

- [ ] **Step 4: Build the Svelte frontend**

```bash
cd packages/desktop && npm run build
```

Expected: exits cleanly with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/lib/invoke.ts packages/desktop/src/lib/types.ts
git commit -m "chore: remove unused getVersionInfo and VersionInfo type"
```

---

## Task 9: Update CI Workflow

**Files:**
- Modify: `.github/workflows/tauri_release.yml`

> **Why rewrite:** Each build target generates its own per-platform `latest.json`. If uploaded separately, each one overwrites the previous and the release ends up with only one platform's data. `tauri-apps/tauri-action` solves this — it merges all platforms into a single `latest.json` and handles signing automatically.

- [ ] **Step 1: Replace the entire workflow file**

```yaml
name: Tauri Desktop Release

on:
  push:
    tags:
      - "v*"

jobs:
  publish-tauri:
    permissions:
      contents: write
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-latest
            target: aarch64-apple-darwin
          - os: macos-latest
            target: x86_64-apple-darwin
          - os: windows-latest
            target: x86_64-pc-windows-msvc

    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install frontend dependencies
        run: npm install
        working-directory: packages/desktop

      - name: Install Rust target
        run: rustup target add ${{ matrix.target }}

      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ""
        with:
          tagName: ${{ github.ref_name }}
          releaseName: "Panna Cotta ${{ github.ref_name }}"
          releaseBody: ""
          releaseDraft: false
          prerelease: false
          projectPath: packages/desktop
          args: --target ${{ matrix.target }}
```

`tauri-action` runs `npm run build` (from `tauri.conf.json` `beforeBuildCommand`), compiles Rust, generates signed `.dmg`/`.exe` + `.sig` files, creates a merged multi-platform `latest.json`, and uploads everything to a single GitHub release.

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/tauri_release.yml
git commit -m "ci: switch to tauri-action for signed multi-platform builds and latest.json"
```

---

## Task 10: Final Verification

- [ ] **Step 1: Full cargo test**

```bash
cd packages/desktop/src-tauri && cargo test
```

Expected: all tests pass.

- [ ] **Step 2: Cargo clippy**

```bash
cd packages/desktop/src-tauri && cargo clippy
```

Expected: no errors (warnings OK).

- [ ] **Step 3: Full Svelte build**

```bash
cd packages/desktop && npm run build
```

Expected: clean build, no TypeScript errors.

- [ ] **Step 4: Smoke test (optional but recommended)**

```bash
cd packages/desktop && npm run tauri dev
```

Verify:
- App launches
- macOS menu bar shows "Panna Cotta > Check for Updates…" when admin window is focused
- Clicking "Check for Updates…" triggers a check (either "up to date" dialog or update flow)
- No console errors about missing commands

- [ ] **Step 5: Final commit if any fixups needed, then tag for release**

Once everything is green, bump version and tag to trigger CI:

```bash
# In tauri.conf.json and Cargo.toml, bump version to 0.1.7
git add packages/desktop/src-tauri/tauri.conf.json packages/desktop/src-tauri/Cargo.toml
git commit -m "chore: bump version to 0.1.7"
git tag v0.1.7
git push origin main --tags
```

CI will build signed artifacts and upload `latest.json`. Existing installs pointing at the endpoint will receive the update on their next check.
