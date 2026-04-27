# Tauri Desktop App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap panna-cotta in a macOS/Windows menu bar app using Tauri — Deno
backend runs as a sidecar, floating window opens on tray click.

**Architecture:** Tauri v2 app in `packages/desktop/`. On launch, spawns the
`stream-backend` compiled Deno binary as a sidecar. Reads `~/.panna-cotta.port`
to determine port. Tray menu shows port, running status, start/stop,
launch-at-login toggle, and quit.

**Tech Stack:** Tauri v2, Rust, tauri-plugin-autostart, tauri-plugin-shell, deno
compile, GitHub Actions

---

## File Map

| File                                                   | Action | Responsibility                                     |
| ------------------------------------------------------ | ------ | -------------------------------------------------- |
| `packages/desktop/package.json`                        | Create | JS workspace metadata for Tauri CLI                |
| `packages/desktop/src-tauri/Cargo.toml`                | Create | Rust dependencies (tauri v2, plugins)              |
| `packages/desktop/src-tauri/tauri.conf.json`           | Create | App config: window, tray, sidecar allowlist        |
| `packages/desktop/src-tauri/capabilities/default.json` | Create | Tauri v2 capability permissions                    |
| `packages/desktop/src-tauri/src/main.rs`               | Create | All app logic: sidecar, tray, window, port polling |
| `packages/desktop/src-tauri/icons/`                    | Create | App icons (PNG set + .ico)                         |
| `packages/desktop/.gitignore`                          | Create | Ignore target/, node_modules/                      |
| `deno.json`                                            | Modify | Add sidecar compile tasks per target               |
| `.github/workflows/tauri_release.yml`                  | Create | GHA: compile sidecar → tauri build → upload        |

---

## Task 1: Scaffold Tauri Package Structure

**Files:**

- Create: `packages/desktop/package.json`
- Create: `packages/desktop/.gitignore`
- Create: `packages/desktop/src-tauri/src/main.rs` (stub)

- [ ] **Step 1: Create package.json**

```json
{
  "name": "panna-cotta-desktop",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "tauri": "tauri"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2"
  }
}
```

Save to `packages/desktop/package.json`.

- [ ] **Step 2: Create .gitignore**

```
target/
node_modules/
src-tauri/binaries/
```

Save to `packages/desktop/.gitignore`.

- [ ] **Step 3: Create directory structure**

```bash
mkdir -p packages/desktop/src-tauri/src
mkdir -p packages/desktop/src-tauri/icons
mkdir -p packages/desktop/src-tauri/capabilities
mkdir -p packages/desktop/src-tauri/binaries
```

- [ ] **Step 4: Create stub main.rs**

```rust
fn main() {
    println!("panna-cotta desktop");
}
```

Save to `packages/desktop/src-tauri/src/main.rs`.

- [ ] **Step 5: Install Tauri CLI**

```bash
cd packages/desktop && npm install
```

Expected: `node_modules/@tauri-apps/cli` present.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/
git commit -m "feat(desktop): scaffold Tauri package structure"
```

---

## Task 2: Cargo.toml and Rust Toolchain

**Files:**

- Create: `packages/desktop/src-tauri/Cargo.toml`
- Create: `packages/desktop/src-tauri/build.rs`

- [ ] **Step 1: Create Cargo.toml**

```toml
[package]
name = "panna-cotta"
version = "0.1.0"
edition = "2021"

[lib]
name = "panna_cotta_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = ["tray-icon", "image-png"] }
tauri-plugin-autostart = "2"
tauri-plugin-shell = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }

[profile.release]
opt-level = "s"
strip = true
```

Save to `packages/desktop/src-tauri/Cargo.toml`.

- [ ] **Step 2: Create build.rs**

```rust
fn main() {
    tauri_build::build()
}
```

Save to `packages/desktop/src-tauri/build.rs`.

- [ ] **Step 3: Verify Rust toolchain installed**

```bash
rustc --version && cargo --version
```

Expected: both print version strings. If missing:
`curl https://sh.rustup.rs -sSf | sh`

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src-tauri/Cargo.toml packages/desktop/src-tauri/build.rs
git commit -m "feat(desktop): add Cargo.toml with Tauri v2 dependencies"
```

---

## Task 3: tauri.conf.json Configuration

**Files:**

- Create: `packages/desktop/src-tauri/tauri.conf.json`
- Create: `packages/desktop/src-tauri/capabilities/default.json`

- [ ] **Step 1: Create tauri.conf.json**

```json
{
  "productName": "Panna Cotta",
  "version": "0.1.0",
  "identifier": "io.mwong.panna-cotta",
  "build": {
    "beforeBuildCommand": "",
    "frontendDist": "../dist-placeholder"
  },
  "app": {
    "withGlobalTauri": false,
    "windows": [
      {
        "label": "main",
        "title": "Panna Cotta",
        "width": 420,
        "height": 680,
        "resizable": true,
        "decorations": false,
        "visible": false,
        "skipTaskbar": true,
        "alwaysOnTop": false
      }
    ],
    "trayIcon": {
      "id": "main",
      "iconPath": "icons/icon.png",
      "iconAsTemplate": true,
      "menuOnLeftClick": true,
      "title": "Panna Cotta"
    },
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "externalBin": ["binaries/stream-backend"]
  }
}
```

Save to `packages/desktop/src-tauri/tauri.conf.json`.

- [ ] **Step 2: Create capabilities/default.json**

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "default capability",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "shell:allow-execute",
    "shell:allow-open",
    "autostart:allow-enable",
    "autostart:allow-disable",
    "autostart:allow-is-enabled"
  ]
}
```

Save to `packages/desktop/src-tauri/capabilities/default.json`.

- [ ] **Step 3: Create placeholder dist directory**

Tauri needs a frontend dist to build even though window loads localhost URL at
runtime.

```bash
mkdir -p packages/desktop/dist-placeholder
echo '<html><body>Loading...</body></html>' > packages/desktop/dist-placeholder/index.html
```

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src-tauri/tauri.conf.json packages/desktop/src-tauri/capabilities/ packages/desktop/dist-placeholder/
git commit -m "feat(desktop): add Tauri configuration and capabilities"
```

---

## Task 4: App Icons

**Files:**

- Create: `packages/desktop/src-tauri/icons/` (PNG set)

- [ ] **Step 1: Generate icons from existing PWA icon**

The project already has PWA icons in `packages/frontend/`. Copy and resize:

```bash
# Use ImageMagick if available, or copy existing icon
cp packages/frontend/icon-192x192.png packages/desktop/src-tauri/icons/icon.png

# Generate required sizes
convert packages/desktop/src-tauri/icons/icon.png -resize 32x32 packages/desktop/src-tauri/icons/32x32.png
convert packages/desktop/src-tauri/icons/icon.png -resize 128x128 packages/desktop/src-tauri/icons/128x128.png
convert packages/desktop/src-tauri/icons/icon.png -resize 256x256 packages/desktop/src-tauri/icons/128x128@2x.png
```

If ImageMagick not available:

```bash
# Use Tauri CLI icon generator from the existing icon
cd packages/desktop && npx tauri icon ../src-tauri/icons/icon.png
```

- [ ] **Step 2: Verify icons exist**

```bash
ls packages/desktop/src-tauri/icons/
```

Expected: `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns` (macOS),
`icon.ico` (Windows), `icon.png`.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src-tauri/icons/
git commit -m "feat(desktop): add app icons"
```

---

## Task 5: main.rs — Sidecar + Port Polling

**Files:**

- Modify: `packages/desktop/src-tauri/src/main.rs`

This task implements sidecar spawning and port file reading. The port file path
is `{home}/.panna-cotta.port` (matching the backend).

- [ ] **Step 1: Write main.rs with sidecar and port polling**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{
    menu::{CheckMenuItem, MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

#[derive(Default)]
struct AppState {
    sidecar: Option<CommandChild>,
    port: Option<u16>,
}

fn port_file_path() -> std::path::PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    std::path::PathBuf::from(home).join(".panna-cotta.port")
}

fn read_port() -> Option<u16> {
    std::fs::read_to_string(port_file_path())
        .ok()
        .and_then(|s| s.trim().parse::<u16>().ok())
}

fn spawn_sidecar(app: &AppHandle, state: &Arc<Mutex<AppState>>) {
    let shell = app.shell();
    match shell.sidecar("stream-backend") {
        Ok(cmd) => match cmd.spawn() {
            Ok((_rx, child)) => {
                let mut s = state.lock().unwrap();
                s.sidecar = Some(child);
            }
            Err(e) => eprintln!("Failed to spawn sidecar: {e}"),
        },
        Err(e) => eprintln!("Failed to create sidecar command: {e}"),
    }
}

fn poll_port(app: AppHandle, state: Arc<Mutex<AppState>>) {
    std::thread::spawn(move || {
        let mut retries = 0;
        loop {
            let port = read_port();
            let mut s = state.lock().unwrap();
            if let Some(p) = port {
                s.port = Some(p);
                drop(s);
                let _ = app.emit("port-updated", p);
            } else {
                retries += 1;
                if retries >= 3 {
                    let _ = app.emit("server-stopped", ());
                }
                drop(s);
            }
            std::thread::sleep(Duration::from_millis(500));
        }
    });
}

pub fn run() {
    let state = Arc::new(Mutex::new(AppState::default()));
    let state_clone = Arc::clone(&state);

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_shell::init())
        .setup(move |app| {
            // Spawn sidecar on startup
            spawn_sidecar(app.handle(), &state_clone);

            // Poll port file
            poll_port(app.handle().clone(), Arc::clone(&state_clone));

            // Build tray menu
            build_tray(app.handle())?;

            // Hide from dock (macOS)
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error running Tauri app");
}

fn main() {
    run();
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItemBuilder::new("Open").id("open").build(app)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let port_item = MenuItemBuilder::new("Port: --").id("port").enabled(false).build(app)?;
    let status_item = MenuItemBuilder::new("○ Stopped").id("status").enabled(false).build(app)?;
    let start_stop = MenuItemBuilder::new("Start").id("start-stop").build(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let autostart = CheckMenuItem::new(app, "Launch at Login", true, false, None::<&str>)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::new("Quit").id("quit").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&open)
        .item(&sep1)
        .item(&port_item)
        .item(&status_item)
        .item(&start_stop)
        .item(&sep2)
        .item(&autostart)
        .item(&sep3)
        .item(&quit)
        .build()?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .on_menu_event(move |app, event| handle_menu_event(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                toggle_window(app);
            }
        })
        .build(app)?;

    Ok(())
}

fn toggle_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    } else {
        open_window(app);
    }
}

fn open_window(app: &AppHandle) {
    let port = {
        // Try to read port from state via global — simplest approach
        read_port().unwrap_or(30000)
    };
    let url = format!("http://localhost:{port}");
    let _ = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse().unwrap()))
        .title("Panna Cotta")
        .inner_size(420.0, 680.0)
        .decorations(false)
        .always_on_top(false)
        .skip_taskbar(true)
        .build();
}

fn handle_menu_event(app: &AppHandle, id: &str) {
    match id {
        "open" => toggle_window(app),
        "quit" => {
            app.exit(0);
        }
        "start-stop" => {
            // Toggle sidecar — simplified: just re-spawn (kill handled by Drop)
            spawn_sidecar_global(app);
        }
        "autostart" => {
            use tauri_plugin_autostart::ManagerExt;
            let autostart = app.autolaunch();
            let is_enabled = autostart.is_enabled().unwrap_or(false);
            if is_enabled {
                let _ = autostart.disable();
            } else {
                let _ = autostart.enable();
            }
        }
        _ => {}
    }
}

fn spawn_sidecar_global(app: &AppHandle) {
    let shell = app.shell();
    if let Ok(cmd) = shell.sidecar("stream-backend") {
        let _ = cmd.spawn();
    }
}
```

Save to `packages/desktop/src-tauri/src/main.rs`.

- [ ] **Step 2: Verify it compiles (errors expected for missing icons/context)**

```bash
cd packages/desktop && cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | head -50
```

Expected: Dependency download + compilation. Icon/context errors resolved in
later tasks.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src-tauri/src/main.rs
git commit -m "feat(desktop): implement sidecar spawn, port polling, tray menu"
```

---

## Task 6: Add Sidecar Compile Tasks to deno.json

The Tauri sidecar binary must be named `stream-backend-{target-triple}` and
placed at `packages/desktop/src-tauri/binaries/`.

- [ ] **Step 1: Read current deno.json**

```bash
cat deno.json
```

- [ ] **Step 2: Add sidecar compile tasks**

Edit `deno.json` tasks section to add:

```json
"compile:sidecar:macos-arm": "deno compile -A --target aarch64-apple-darwin --include packages/frontend --output packages/desktop/src-tauri/binaries/stream-backend-aarch64-apple-darwin packages/backend/server.ts",
"compile:sidecar:macos-x64": "deno compile -A --target x86_64-apple-darwin --include packages/frontend --output packages/desktop/src-tauri/binaries/stream-backend-x86_64-apple-darwin packages/backend/server.ts",
"compile:sidecar:windows-x64": "deno compile -A --target x86_64-pc-windows-msvc --include packages/frontend --output packages/desktop/src-tauri/binaries/stream-backend-x86_64-pc-windows-msvc packages/backend/server.ts"
```

- [ ] **Step 3: Verify task runs (on your current machine)**

On Apple Silicon Mac:

```bash
deno task compile:sidecar:macos-arm
ls packages/desktop/src-tauri/binaries/
```

Expected: `stream-backend-aarch64-apple-darwin` binary present.

- [ ] **Step 4: Commit**

```bash
git add deno.json
git commit -m "feat(desktop): add sidecar compile tasks for Tauri targets"
```

---

## Task 7: GHA Workflow — Tauri Release

**Files:**

- Create: `.github/workflows/tauri_release.yml`

- [ ] **Step 1: Create workflow**

```yaml
name: Tauri Desktop Release

on:
  push:
    tags:
      - "v*"

jobs:
  build-sidecar:
    strategy:
      matrix:
        include:
          - os: macos-latest
            target: aarch64-apple-darwin
            task: compile:sidecar:macos-arm
          - os: macos-latest
            target: x86_64-apple-darwin
            task: compile:sidecar:macos-x64
          - os: windows-latest
            target: x86_64-pc-windows-msvc
            task: compile:sidecar:windows-x64

    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4

      - uses: denoland/setup-deno@v1
        with:
          deno-version: v2.x

      - name: Inject version from tag
        shell: bash
        run: |
          VERSION="${GITHUB_REF_NAME#v}"
          sed -i.bak "s|CURRENT_VERSION = \".*\"|CURRENT_VERSION = \"$VERSION\"|" packages/backend/services/version.ts
          rm -f packages/backend/services/version.ts.bak

      - name: Compile sidecar
        run: deno task ${{ matrix.task }}

      - name: Upload sidecar artifact
        uses: actions/upload-artifact@v4
        with:
          name: sidecar-${{ matrix.target }}
          path: packages/desktop/src-tauri/binaries/

  build-tauri:
    needs: build-sidecar
    strategy:
      matrix:
        include:
          - os: macos-latest
            target: aarch64-apple-darwin
            sidecar: sidecar-aarch64-apple-darwin
          - os: macos-latest
            target: x86_64-apple-darwin
            sidecar: sidecar-x86_64-apple-darwin
          - os: windows-latest
            target: x86_64-pc-windows-msvc
            sidecar: sidecar-x86_64-pc-windows-msvc

    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4

      - name: Download sidecar
        uses: actions/download-artifact@v4
        with:
          name: ${{ matrix.sidecar }}
          path: packages/desktop/src-tauri/binaries/

      - name: Make sidecar executable (macOS)
        if: runner.os != 'Windows'
        run: chmod +x packages/desktop/src-tauri/binaries/*

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install Tauri CLI
        run: cd packages/desktop && npm install

      - name: Install Rust target
        run: rustup target add ${{ matrix.target }}

      - name: Install Linux deps
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf

      - name: Build Tauri app
        run: cd packages/desktop && npx tauri build --target ${{ matrix.target }} --no-bundle
        env:
          TAURI_SIGNING_PRIVATE_KEY: ""

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: tauri-${{ matrix.target }}
          path: |
            packages/desktop/src-tauri/target/${{ matrix.target }}/release/bundle/

  release:
    needs: build-tauri
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - name: Download all Tauri artifacts
        uses: actions/download-artifact@v4
        with:
          pattern: tauri-*
          path: artifacts/
          merge-multiple: true

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          draft: false
          prerelease: false
          files: artifacts/**/*.dmg,artifacts/**/*.exe,artifacts/**/*.msi,artifacts/**/*.app.tar.gz
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Save to `.github/workflows/tauri_release.yml`.

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/tauri_release.yml
git commit -m "feat(desktop): add GHA workflow for Tauri release builds"
```

---

## Task 8: Local Build Verification

- [ ] **Step 1: Compile sidecar for your machine**

On Apple Silicon:

```bash
deno task compile:sidecar:macos-arm
```

Expected: binary at
`packages/desktop/src-tauri/binaries/stream-backend-aarch64-apple-darwin`

- [ ] **Step 2: Run Tauri in dev mode**

```bash
cd packages/desktop && npx tauri dev
```

Expected: App launches, tray icon appears. Click icon → floating window opens at
localhost port.

- [ ] **Step 3: Verify tray menu items**

- Port shows actual port number
- Status shows `● Running` when server up
- Stop button kills server → status shows `○ Stopped`
- Start button respawns → status shows `● Running`
- Launch at Login checkbox toggles
- Quit exits fully

- [ ] **Step 4: Verify window behavior**

- Click tray → window appears
- Click tray again → window hides
- Press Esc in window → window hides

- [ ] **Step 5: Build release binary**

```bash
cd packages/desktop && npx tauri build
```

Expected: `.app` bundle at
`packages/desktop/src-tauri/target/release/bundle/macos/Panna Cotta.app`

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat(desktop): complete Tauri menu bar app"
```

---

## Notes

**Sidecar binary naming:** Tauri requires the binary to be named exactly
`{name}-{target-triple}` in the `binaries/` folder. The `tauri.conf.json`
references `"binaries/stream-backend"` (no triple — Tauri appends the current
target triple automatically at build time).

**Port file path:** Backend writes to `{HOME}/.panna-cotta.port`. Rust reads
same path via `std::env::var("HOME")` (macOS/Linux) or `USERPROFILE` (Windows).

**Unsigned app on macOS:** Users will see Gatekeeper warning on first launch. To
bypass: right-click the `.app` → Open → Open anyway. Or:
`xattr -d com.apple.quarantine "Panna Cotta.app"`.

**Windows:** The `.exe` installer from Tauri build is NSIS-based. Same unsigned
warning from SmartScreen — user clicks "More info" → "Run anyway".
